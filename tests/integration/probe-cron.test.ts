/**
 * The every-minute probe job (the builtin monitor runner) end to end in workerd: `runJob` reads the legacy
 * probes of sites/demo.json (seeded into D1 as version 1) as monitors, checks them through a mocked fetch,
 * and applies the results through `applyResults` and the ingest engine into the migrated D1 and KV, where
 * the read routes see them like any other source. Runner states land in `monitor_runners`.
 */
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduled } from "@/platform/cloudflare/scheduled";
import { JOBS } from "@/platform/types";
import { runJob } from "@/worker/cron";
import { schema } from "@/worker/db";
import { KvModelCache } from "@/worker/engine/kv-cache";
import { testPlatform, workerEnv } from "../support/platform";
import { json, pipeline } from "../support/worker-pipeline";

const HEALTH = "https://example.org/";
const WEB = "https://example.com/";
const T0 = Date.parse("2026-09-28T01:00:00Z");
const minute = (n: number) => T0 + n * 60_000;
const platform = testPlatform();
const db = platform.db;

/** A fetch answering each configured URL with its current status; any other URL fails the test. */
function edge(statuses: Record<string, number>) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const status = statuses[String(url)];
    if (status === undefined) throw new Error("unexpected probe target");
    return new Response(null, { status });
  });
}

const run = (n: number, fetch: ReturnType<typeof edge>) =>
  runJob(platform, "probes", minute(n), {
    transport: { fetch: fetch as unknown as typeof globalThis.fetch, tcp: vi.fn() },
    sleep: async () => {},
    now: () => minute(n) + 4_000,
  });

const beats = (serviceId: string) =>
  db
    .select({
      ts: schema.heartbeats.ts,
      status: schema.heartbeats.status,
      message: schema.heartbeats.message,
    })
    .from(schema.heartbeats)
    .where(and(eq(schema.heartbeats.site, "demo"), eq(schema.heartbeats.serviceId, serviceId)))
    .orderBy(asc(schema.heartbeats.ts));

afterEach(() => vi.restoreAllMocks());

describe("cron: every-minute probes", () => {
  it("writes heartbeats, opens and resolves an incident, and keeps probe:cf fresh", async () => {
    const up = edge({ [HEALTH]: 200, [WEB]: 200 });
    const first = await run(0, up);
    expect(first).toMatchObject({
      job: "probes",
      probes: { sites: 1, checks: 2, down: 0, opened: [], resolved: [], failedSites: 0 },
    });
    expect(up.mock.calls.map(([url]) => String(url)).sort()).toEqual([WEB, HEALTH].sort());

    const down = edge({ [HEALTH]: 200, [WEB]: 503 });
    const second = await run(1, down);
    expect(second.probes).toMatchObject({
      checks: 2,
      down: 1,
      opened: ["probe:web-app:2026-09-28T01:01:04Z"],
      resolved: [],
    });
    // The failing check was retried once before it counted as down.
    expect(down.mock.calls.filter(([url]) => String(url) === WEB)).toHaveLength(2);

    const third = await run(2, up);
    expect(third.probes).toMatchObject({ opened: [], resolved: ["probe:web-app:2026-09-28T01:01:04Z"] });

    expect((await beats("probe:web-app")).map((b) => [b.status, b.message])).toEqual([
      ["up", "HTTP 200"],
      ["down", "HTTP 503"],
      ["up", "HTTP 200"],
    ]);
    expect(await beats("probe:api-health")).toHaveLength(3);
    // Heartbeats at the check's start second.
    expect((await beats("probe:web-app")).map((b) => b.ts)).toEqual([0, 1, 2].map((n) => minute(n) + 4_000));

    const states = await db
      .select()
      .from(schema.monitorRunners)
      .where(eq(schema.monitorRunners.site, "demo"))
      .orderBy(asc(schema.monitorRunners.monitorId));
    expect(states.map((r) => [r.monitorId, r.runner, r.lastTs, r.lastStatus, r.consecutiveDown])).toEqual([
      ["api-health", "builtin", minute(2) + 4_000, "up", 0],
      ["web-app", "builtin", minute(2) + 4_000, "up", 0],
    ]);

    const services = await db
      .select({ id: schema.services.id, kind: schema.services.kind, target: schema.services.targetDisplay })
      .from(schema.services)
      .where(eq(schema.services.site, "demo"))
      .orderBy(asc(schema.services.id));
    expect(services).toEqual([
      { id: "probe:api-health", kind: "http", target: "example.org/" },
      { id: "probe:web-app", kind: "http", target: "example.com/" },
    ]);

    const cached = await new KvModelCache(platform.kv).get("demo");
    expect(cached?.services.map((s) => [s.id, s.status]).sort()).toEqual([
      ["probe:api-health", "up"],
      ["probe:web-app", "up"],
    ]);

    const { get, setNow } = pipeline(new Date(minute(2) + 30_000));
    const report = await json(await get("/api/sites/demo/sources"));
    expect(report.sources.find((s: { id: string }) => s.id === "probe:cf")).toMatchObject({
      kind: "probe",
      expectedIntervalS: 60,
      lastSeenAt: "2026-09-28T01:02:04Z",
      freshness: "fresh",
    });
    setNow(new Date(minute(10)));
    const later = await json(await get("/api/sites/demo/sources"));
    expect(later.sources.find((s: { id: string }) => s.id === "probe:cf").freshness).toBe("stale");
  });

  it("runs the configured probes from the scheduled handler and logs one line per run", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 204 }));
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const ctx = createExecutionContext();
    scheduled(createScheduledController({ cron: JOBS.probes, scheduledTime: minute(20) }), workerEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(logs.map((l) => JSON.parse(l))).toEqual([
      { evt: "cron", job: "probes", opened: 0, resolved: 0, sites: 1, checks: 2, down: 0, failedSites: 0 },
    ]);
  });
});
