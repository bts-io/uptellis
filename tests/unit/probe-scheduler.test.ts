import { describe, expect, it } from "vitest";
import { PROBE_SOURCE_ID, ProbeConfig } from "@/shared/config";
import { ModelDelta } from "@/shared/schemas";
import { normalizeProbes, probeTarget } from "@/worker/adapters/probe";
import { isDue, mapBounded } from "@/worker/probes/schedule";

const probe = (id: string, over: Record<string, unknown> = {}) =>
  ProbeConfig.parse({ id, name: `Probe ${id}`, url: `https://${id}.example.com/api/healthz?x=1`, ...over });
const AT = new Date("2026-09-28T00:05:00Z");

describe("probe schedule", () => {
  it("runs every minute at 60 s and on multiples of the interval otherwise", () => {
    const minute = (m: number) => Date.parse("2026-09-28T00:00:00Z") + m * 60_000 + 3_000;
    expect([0, 1, 2, 3].map((m) => isDue(probe("a"), minute(m)))).toEqual([true, true, true, true]);
    const five = probe("b", { intervalS: 300 });
    expect([0, 1, 4, 5, 10].map((m) => isDue(five, minute(m)))).toEqual([true, false, false, true, true]);
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

describe("probe adapter", () => {
  it("builds a valid delta: http services on host + path, one beat each at the scheduled time", () => {
    const delta = normalizeProbes(
      [
        { probe: probe("web"), result: { status: "up", latencyMs: 120, message: "HTTP 200" } },
        {
          probe: probe("api", { method: "HEAD" }),
          result: { status: "down", latencyMs: null, message: "timeout" },
        },
      ],
      PROBE_SOURCE_ID,
      "demo",
      AT,
      new Date(AT.getTime() + 12_000),
    );
    expect(ModelDelta.safeParse(delta).success).toBe(true);
    expect(delta).toMatchObject({
      site: "demo",
      generatedAt: "2026-09-28T00:05:00Z",
      source: { sourceId: "probe:cf", seenAt: "2026-09-28T00:05:00Z", ok: true, error: null },
      facts: [],
    });
    expect(
      delta.services.map((s) => [s.id, s.kind, s.targetDisplay, s.method, s.status, s.intervalS]),
    ).toEqual([
      ["probe:web", "http", "web.example.com/api/healthz", "GET", "up", 60],
      ["probe:api", "http", "api.example.com/api/healthz", "HEAD", "down", 60],
    ]);
    expect(
      delta.heartbeats.map((h) => [h.serviceId, h.ts, h.status, h.latencyMs, h.message, h.important]),
    ).toEqual([
      ["probe:web", "2026-09-28T00:05:00Z", "up", 120, "HTTP 200", true],
      ["probe:api", "2026-09-28T00:05:00Z", "down", null, "timeout", true],
    ]);
  });

  it("marks a beat important only on a status change and keeps the previous uptime figures", () => {
    const first = normalizeProbes(
      [{ probe: probe("web"), result: { status: "up", latencyMs: 90, message: "HTTP 200" } }],
      PROBE_SOURCE_ID,
      "demo",
      AT,
      AT,
    );
    const previous = [{ ...first.services[0]!, uptime24h: 0.99, avgLatencyMs: 100 }];
    const next = (status: "up" | "down") =>
      normalizeProbes(
        [{ probe: probe("web"), result: { status, latencyMs: 80, message: "HTTP 200" } }],
        PROBE_SOURCE_ID,
        "demo",
        new Date(AT.getTime() + 60_000),
        AT,
        { previous },
      );
    expect(next("up").heartbeats[0]!.important).toBe(false);
    expect(next("down").heartbeats[0]!.important).toBe(true);
    expect(next("up").services[0]).toMatchObject({ uptime24h: 0.99, avgLatencyMs: 100, latencyMs: 80 });
  });

  it("shows a non-default port but never the scheme or query", () => {
    expect(probeTarget("https://git.example.com:8443/a/b?token=x#frag")).toBe("git.example.com:8443/a/b");
    expect(probeTarget("https://git.example.com:443/")).toBe("git.example.com/");
  });
});
