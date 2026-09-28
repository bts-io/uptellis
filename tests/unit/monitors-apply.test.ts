/**
 * `applyResults` over the in-memory store: runner state, retries and `pending`, quorum across builtin and
 * an agent, ignored results, unsupported types, maintenance, and the one delta per call (services on the
 * first runner's source, freshness on the reporting runner's source).
 */
import { describe, expect, it } from "vitest";
import type { CheckResult } from "@/shared/monitors";
import { ModelDelta } from "@/shared/schemas";
import { applyResults } from "@/worker/monitors/apply";
import { memoryMonitors, monitorSite } from "../support/monitors";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const iso = (t: number) => new Date(t).toISOString().replace(".000Z", "Z");
const min = (n: number) => NOW + n * 60_000;

const result = (
  monitorId: string,
  t: number,
  status: CheckResult["status"],
  over: Partial<CheckResult> = {},
) =>
  ({
    monitorId,
    ts: iso(t),
    status,
    latencyMs: status === "down" ? null : 40,
    message: status === "down" ? "HTTP 503" : "HTTP 200",
    ...over,
  }) satisfies CheckResult;

const web = { id: "web", name: "Web", type: "http", url: "https://example.com/health" };
const agents = [{ id: "office-1", name: "Office" }];

const cf = { site: "demo", runner: "builtin", runtime: "cloudflare" } as const;
const office = { site: "demo", runner: "office-1", runtime: "cloudflare" } as const;

describe("applyResults: one runner", () => {
  it("turns a first down into pending, confirms it after the retries, and recovers", async () => {
    const { backend, store, runners } = memoryMonitors(monitorSite({ monitors: [web] }));
    const a = await applyResults(backend, cf, [result("web", min(-3), "up")], new Date(min(-3) + 5_000));
    expect(a).toMatchObject({ accepted: 1, ignored: 0, source: "probe:cf", down: 0 });
    const b = await applyResults(backend, cf, [result("web", min(-2), "down")], new Date(min(-2) + 5_000));
    expect(b.incidents.opened).toEqual([]);
    expect(store.services.get("probe:web")?.status).toBe("pending");
    const c = await applyResults(backend, cf, [result("web", min(-1), "down")], new Date(min(-1) + 5_000));
    expect(c.incidents.opened).toEqual([`probe:web:${iso(min(-1))}`]);
    const d = await applyResults(backend, cf, [result("web", min(0), "up")], new Date(min(0) + 5_000));
    expect(d.incidents.resolved).toEqual([`probe:web:${iso(min(-1))}`]);

    const beats = [...store.heartbeats.values()].map((h) => [h.ts, h.status, h.important]);
    expect(beats).toEqual([
      [iso(min(-3)), "up", true],
      [iso(min(-2)), "pending", true],
      [iso(min(-1)), "down", true],
      [iso(min(0)), "up", true],
    ]);
    expect(runners.get("demo", "web", "builtin")).toMatchObject({ lastStatus: "up", consecutiveDown: 0 });
    expect(store.services.get("probe:web")).toMatchObject({
      source: "probe:cf",
      externalId: "web",
      kind: "http",
      targetDisplay: "example.com/health",
      method: "GET",
      intervalS: 60,
      timeoutS: 10,
      status: "up",
      latencyMs: 40,
    });
    for (const delta of store.deltas) expect(ModelDelta.safeParse(delta).success).toBe(true);
  });

  it("applies a batch in time order, one delta per call, and keeps the previous uptime figures", async () => {
    const { backend, store } = memoryMonitors(monitorSite({ monitors: [{ ...web, retries: 0 }] }));
    await applyResults(backend, cf, [result("web", min(-5), "up")], new Date(min(-5)));
    store.services.set("probe:web", {
      ...store.services.get("probe:web")!,
      uptime24h: 0.99,
      avgLatencyMs: 50,
    });
    const out = await applyResults(
      backend,
      cf,
      [result("web", min(-1), "up"), result("web", min(-3), "down"), result("web", min(-2), "up")],
      new Date(NOW),
    );
    expect(out).toMatchObject({ accepted: 3, ignored: 0, down: 1 });
    expect(store.deltas).toHaveLength(2);
    const last = store.deltas.at(-1)!;
    expect(last.heartbeats.map((h) => [h.ts, h.status, h.important])).toEqual([
      [iso(min(-3)), "down", true],
      [iso(min(-2)), "up", true],
      [iso(min(-1)), "up", false],
    ]);
    expect(last.source).toMatchObject({ sourceId: "probe:cf", seenAt: iso(NOW), ok: true });
    expect(last.generatedAt).toBe(iso(NOW));
    expect(store.services.get("probe:web")).toMatchObject({ uptime24h: 0.99, avgLatencyMs: 50 });
    // The outage opened and closed within the batch.
    expect(out.incidents.opened).toEqual(out.incidents.resolved);
    expect(out.incidents.opened).toHaveLength(1);
  });
});

describe("applyResults: quorum across builtin and an agent", () => {
  const both = { ...web, retries: 0, runners: ["builtin", "office-1"] };

  it("is degraded while one of two runners is down, down once both are, on the first runner's source", async () => {
    const { backend, store } = memoryMonitors(monitorSite({ monitors: [both], agents }));
    await applyResults(backend, cf, [result("web", min(-3), "up")], new Date(min(-3)));
    await applyResults(backend, office, [result("web", min(-3), "up")], new Date(min(-3)));

    const one = await applyResults(backend, cf, [result("web", min(-2), "down")], new Date(min(-2)));
    expect(one.incidents.opened).toEqual([]);
    expect(store.services.get("probe:web")).toMatchObject({ status: "degraded" });
    expect(store.deltas.at(-1)!.heartbeats[0]).toMatchObject({
      status: "degraded",
      message: "down from builtin",
    });

    const two = await applyResults(
      backend,
      office,
      [result("web", min(-2) + 10_000, "down")],
      new Date(min(-2) + 15_000),
    );
    expect(two).toMatchObject({ accepted: 1, source: "probe:office-1" });
    expect(two.incidents.opened).toEqual([`probe:web:${iso(min(-2) + 10_000)}`]);
    const svc = store.services.get("probe:web")!;
    expect(svc).toMatchObject({ status: "down", source: "probe:cf" });
    expect(store.deltas.at(-1)!.heartbeats[0]!.message).toBe("builtin: HTTP 503");

    // Freshness is the reporting runner's: the agent's source was touched, the service source untouched by it.
    expect(store.sources.get("probe:office-1")?.lastSeenAt).toBe(iso(min(-2) + 15_000));
    expect(store.sources.get("probe:cf")?.lastSeenAt).toBe(iso(min(-2)));

    // Below quorum again: degraded, which answers, so the outage ends there (incidents.ts).
    const back = await applyResults(backend, cf, [result("web", min(-1), "up")], new Date(min(-1)));
    expect(back.incidents.resolved).toEqual([`probe:web:${iso(min(-2) + 10_000)}`]);
    expect(store.services.get("probe:web")?.status).toBe("degraded");
    const up = await applyResults(backend, office, [result("web", min(-1), "up")], new Date(min(-1) + 1_000));
    expect(up.incidents).toEqual({ opened: [], resolved: [] });
    expect(store.services.get("probe:web")?.status).toBe("up");
  });

  it("lets the remaining runner decide while the other is silent", async () => {
    const { backend, store } = memoryMonitors(monitorSite({ monitors: [both], agents }));
    await applyResults(backend, office, [result("web", min(-30), "up")], new Date(min(-30)));
    const out = await applyResults(backend, cf, [result("web", min(0), "down")], new Date(NOW));
    expect(out.incidents.opened).toEqual([`probe:web:${iso(NOW)}`]);
    expect(store.services.get("probe:web")?.status).toBe("down");
  });
});

describe("applyResults: ignored results", () => {
  it("drops old, future, unknown, unassigned, disabled and duplicate results, and never retries them", async () => {
    const config = monitorSite({
      agents,
      monitors: [
        { ...web, retries: 0 },
        { id: "lan", name: "LAN", type: "tcp", host: "nas.lan", port: 445, runners: ["office-1"] },
        { id: "off", name: "Off", type: "http", url: "https://example.org/", enabled: false },
      ],
    });
    const { backend, store, runners } = memoryMonitors(config);
    const out = await applyResults(
      backend,
      cf,
      [
        result("web", NOW - 24 * 3600_000 - 1_000, "down"),
        result("web", NOW + 61_000, "down"),
        result("nope", NOW, "down"),
        result("lan", NOW, "down"),
        result("off", NOW, "down"),
        result("web", NOW - 1_000, "up"),
        result("web", NOW - 1_000, "down"),
      ],
      new Date(NOW),
    );
    expect(out).toMatchObject({ accepted: 1, ignored: 6 });
    const again = await applyResults(
      backend,
      cf,
      [result("web", NOW - 1_000, "down")],
      new Date(NOW + 5_000),
    );
    expect(again).toMatchObject({ accepted: 0, ignored: 1 });
    expect(store.services.get("probe:web")?.status).toBe("up");
    expect(store.services.has("probe:lan")).toBe(false);
    expect(runners.get("demo", "web", "builtin")).toMatchObject({ lastStatus: "up" });
    // The runner is alive: an all-ignored call still touches its source.
    expect(store.sources.get("probe:cf")?.lastSeenAt).toBe(iso(NOW + 5_000));
    expect(store.deltas.at(-1)).toMatchObject({ services: [], heartbeats: [] });
  });

  it("ignores everything for an unknown site", async () => {
    const { backend, store } = memoryMonitors(monitorSite({ monitors: [web] }));
    const out = await applyResults(
      backend,
      { ...cf, site: "other" },
      [result("web", NOW, "up")],
      new Date(NOW),
    );
    expect(out).toMatchObject({ accepted: 0, ignored: 1 });
    expect(store.deltas).toEqual([]);
  });
});

describe("applyResults: types a runner cannot run", () => {
  const ping = {
    id: "gw",
    name: "Gateway",
    type: "ping",
    host: "example.org",
    retries: 0,
    runners: ["builtin", "office-1"],
  };

  it("ignores builtin ping results on Cloudflare and confirms on the agent alone", async () => {
    const { backend, store } = memoryMonitors(monitorSite({ monitors: [ping], agents }));
    const cfOut = await applyResults(backend, cf, [result("gw", NOW - 5_000, "up")], new Date(NOW));
    expect(cfOut).toMatchObject({ accepted: 0, ignored: 1 });
    const out = await applyResults(
      backend,
      office,
      [result("gw", NOW - 4_000, "down", { message: "timeout" })],
      new Date(NOW),
    );
    expect(out.incidents.opened).toEqual([`probe:gw:${iso(NOW - 4_000)}`]);
    expect(store.services.get("probe:gw")).toMatchObject({
      status: "down",
      kind: "ping",
      source: "probe:cf",
      targetDisplay: "example.org",
    });
    expect(store.services.get("probe:gw")?.method).toBeUndefined();
  });

  it("runs every type for builtin in Docker, reporting as probe:server", async () => {
    const { backend, store } = memoryMonitors(monitorSite({ monitors: [ping], agents }));
    const out = await applyResults(
      backend,
      { ...cf, runtime: "docker" },
      [result("gw", NOW - 5_000, "up")],
      new Date(NOW),
    );
    expect(out).toMatchObject({ accepted: 1, source: "probe:server" });
    expect(store.services.get("probe:gw")?.source).toBe("probe:server");
  });
});

describe("applyResults: maintenance and certificates", () => {
  it("shows maintenance instead of down and opens nothing", async () => {
    const { backend, store } = memoryMonitors(
      monitorSite({ monitors: [{ ...web, retries: 0 }] }),
      (_config, serviceId) => serviceId === "probe:web",
    );
    const out = await applyResults(backend, cf, [result("web", NOW, "down")], new Date(NOW));
    expect(out.incidents.opened).toEqual([]);
    expect(store.services.get("probe:web")?.status).toBe("maintenance");
    expect(store.deltas[0]!.heartbeats[0]!.status).toBe("maintenance");
  });

  it("carries a TLS monitor's certificate onto its service", async () => {
    const tls = { id: "cert", name: "Cert", type: "tls", host: "example.org" };
    const { backend, store } = memoryMonitors(monitorSite({ monitors: [tls] }));
    const cert = {
      valid: true,
      cn: "example.org",
      issuer: "Example CA",
      validTo: "2026-10-03T00:00:00Z",
      daysRemaining: 5,
    };
    await applyResults(
      backend,
      { ...cf, runtime: "docker" },
      [result("cert", NOW, "degraded", { message: "5 days left", cert })],
      new Date(NOW),
    );
    expect(store.services.get("probe:cert")).toMatchObject({ kind: "tls", status: "degraded", cert });
  });
});
