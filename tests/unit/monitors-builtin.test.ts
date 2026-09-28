/**
 * The builtin runner over memory: the schedule, bounded concurrency, which monitors run on which runtime,
 * the legacy probes as monitors (same service ids, `probe:cf` on Cloudflare), implied runner sources, and
 * the temporary legacy check adapter.
 */
import { describe, expect, it, vi } from "vitest";
import type { CheckResult, RunCheck } from "@/shared/monitors";
import { resetSiteSourceSync, siteSources } from "@/worker/engine/sites";
import { runBuiltin } from "@/worker/monitors/builtin";
import { legacyRunCheck } from "@/worker/monitors/legacy-check";
import { isDue, mapBounded } from "@/worker/monitors/schedule";
import { memoryMonitors, monitorSite } from "../support/monitors";

const T0 = Date.parse("2026-09-28T00:00:00Z");
const minute = (m: number) => T0 + m * 60_000;
const iso = (t: number) => new Date(t).toISOString().replace(".000Z", "Z");

const probe = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Probe ${id}`,
  url: `https://${id}.example.com/api/healthz?x=1`,
  ...over,
});
const agents = [{ id: "office-1", name: "Office" }];

describe("schedule", () => {
  it("runs every minute at 60 s and on multiples of the interval otherwise", () => {
    const at = (m: number) => minute(m) + 3_000;
    expect([0, 1, 2, 3].map((m) => isDue({ intervalS: 60 }, at(m)))).toEqual([true, true, true, true]);
    expect([0, 1, 4, 5, 10].map((m) => isDue({ intervalS: 300 }, at(m)))).toEqual([
      true,
      false,
      false,
      true,
      true,
    ]);
  });

  it("bounds concurrency and keeps the input order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapBounded([5, 1, 4, 2, 3, 0, 6, 7], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0, 60, 70]);
    expect(peak).toBe(3);
    expect(await mapBounded([], 3, async (n: number) => n)).toEqual([]);
  });
});

/** A `runCheck` answering from a table of monitor id -> status, recording what it ran. */
function fakeCheck(statuses: Record<string, CheckResult["status"]>) {
  const ran: string[] = [];
  const run: RunCheck = async (m, o) => {
    ran.push(m.id);
    const status = statuses[m.id] ?? "up";
    return {
      monitorId: m.id,
      ts: iso(o.now?.() ?? 0),
      status,
      latencyMs: status === "down" ? null : 30,
      message: status === "down" ? "timeout" : "ok",
    };
  };
  return { ran, run };
}

const transport = { fetch: vi.fn(), tcp: vi.fn() } as never;

describe("runBuiltin", () => {
  const config = monitorSite({
    agents,
    sources: [{ id: "probe:cf", kind: "probe", expectedIntervalS: 60 }],
    probes: [probe("web")],
    monitors: [
      { id: "slow", name: "Slow", type: "http", url: "https://example.org/", intervalS: 300 },
      { id: "port", name: "Port", type: "tcp", host: "example.org", port: 22, retries: 0 },
      { id: "gw", name: "Gateway", type: "ping", host: "example.org" },
      { id: "lan", name: "LAN", type: "tcp", host: "nas.lan", port: 445, runners: ["office-1"] },
      { id: "off", name: "Off", type: "http", url: "https://example.net/", enabled: false },
    ],
  });

  it("checks the due builtin monitors this runtime runs and applies them as probe:cf", async () => {
    resetSiteSourceSync();
    const { backend, store } = memoryMonitors(config);
    const { ran, run } = fakeCheck({ port: "down" });
    const out = await runBuiltin(backend, "cloudflare", minute(1), {
      runCheck: run,
      transport,
      version: "0.0.0-test",
      now: () => minute(1) + 2_000,
    });
    expect(ran.sort()).toEqual(["port", "web"]);
    expect(out).toEqual({
      sites: 1,
      checks: 2,
      down: 1,
      opened: [`probe:port:${iso(minute(1) + 2_000)}`],
      resolved: [],
      failedSites: 0,
    });
    // The legacy probe keeps its service id, on probe:cf, with no extra retries.
    expect(store.services.get("probe:web")).toMatchObject({ source: "probe:cf", kind: "http", status: "up" });
    expect(store.services.get("probe:port")).toMatchObject({
      source: "probe:cf",
      kind: "port",
      status: "down",
    });
    expect(store.sources.get("probe:office-1")?.expectedIntervalS).toBe(60);

    const five = await runBuiltin(backend, "cloudflare", minute(5), {
      runCheck: fakeCheck({}).run,
      transport,
      version: "0.0.0-test",
      now: () => minute(5) + 2_000,
    });
    expect(five).toMatchObject({ checks: 3, down: 0, resolved: [`probe:port:${iso(minute(1) + 2_000)}`] });
  });

  it("runs every type in Docker and reports as probe:server", async () => {
    resetSiteSourceSync();
    const { backend, store } = memoryMonitors(config);
    const { ran, run } = fakeCheck({});
    await runBuiltin(backend, "docker", minute(5), { runCheck: run, transport, version: "0.0.0-test" });
    expect(ran.sort()).toEqual(["gw", "port", "slow", "web"]);
    expect(store.services.get("probe:gw")?.source).toBe("probe:server");
    expect(store.sources.get("probe:server")).toMatchObject({ kind: "probe", expectedIntervalS: 60 });
  });

  it("logs a failing site by error name and goes on", async () => {
    resetSiteSourceSync();
    const { backend } = memoryMonitors(config);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    backend.runners.load = async () => {
      throw new RangeError("detail that must not be logged");
    };
    const out = await runBuiltin(backend, "cloudflare", minute(1), {
      runCheck: fakeCheck({}).run,
      transport,
      version: "0.0.0-test",
    });
    expect(out.failedSites).toBe(1);
    expect(warn.mock.calls.map((c) => c.join(" "))).toEqual([
      JSON.stringify({ evt: "probes", site: "demo", name: "RangeError" }),
    ]);
    warn.mockRestore();
  });
});

describe("implied runner sources", () => {
  it("adds each runner's source with its smallest interval, keeps listed ones, skips what cannot run", () => {
    const config = monitorSite({
      agents: [...agents, { id: "office-2", name: "Office 2" }],
      sources: [{ id: "kuma:watch-1", kind: "kuma", expectedIntervalS: 60 }],
      monitors: [
        {
          id: "a",
          name: "A",
          type: "http",
          url: "https://example.org/",
          intervalS: 300,
          runners: ["builtin", "office-1"],
        },
        {
          id: "b",
          name: "B",
          type: "tcp",
          host: "nas.lan",
          port: 445,
          intervalS: 120,
          runners: ["office-1"],
        },
        { id: "c", name: "C", type: "ping", host: "example.org", intervalS: 180, runners: ["builtin"] },
        { id: "d", name: "D", type: "ping", host: "example.org", runners: ["office-2"], enabled: false },
      ],
    });
    expect(siteSources(config, "cloudflare")).toEqual([
      { id: "kuma:watch-1", kind: "kuma", expectedIntervalS: 60 },
      { id: "probe:cf", kind: "probe", expectedIntervalS: 300 },
      { id: "probe:office-1", kind: "probe", expectedIntervalS: 120 },
    ]);
    expect(siteSources(config, "docker")).toContainEqual({
      id: "probe:server",
      kind: "probe",
      expectedIntervalS: 180,
    });
    const listed = monitorSite({
      sources: [{ id: "probe:cf", kind: "probe", expectedIntervalS: 90 }],
      probes: [probe("web")],
    });
    expect(siteSources(listed, "cloudflare")).toEqual([
      { id: "probe:cf", kind: "probe", expectedIntervalS: 90 },
    ]);
  });
});

describe("legacy check adapter (until src/checks lands)", () => {
  const http = { id: "web", name: "Web", type: "http", url: "https://example.com/" } as const;

  it("checks http through the edge checker and stamps the start second", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 503 }));
    const r = await legacyRunCheck(
      {
        ...http,
        method: "HEAD",
        expectStatus: { min: 200, max: 399 },
        keywordAbsent: false,
        intervalS: 60,
        timeoutS: 5,
        retries: 0,
        runners: ["builtin"],
        enabled: true,
      },
      {
        transport: { fetch, tcp: vi.fn() } as never,
        version: "t",
        sleep: async () => {},
        now: () => T0 + 1_500,
      },
    );
    expect(r).toEqual({
      monitorId: "web",
      ts: iso(T0 + 1_000),
      status: "down",
      latencyMs: expect.any(Number),
      message: "HTTP 503",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports other types as not supported", async () => {
    const r = await legacyRunCheck(
      {
        id: "p",
        name: "P",
        type: "tcp",
        host: "example.org",
        port: 22,
        intervalS: 60,
        timeoutS: 5,
        retries: 0,
        runners: ["builtin"],
        enabled: true,
      },
      { transport: {} as never, version: "t", now: () => T0 },
    );
    expect(r).toMatchObject({ status: "down", message: "not supported", latencyMs: null });
  });
});
