/**
 * The every-minute probe job end to end in workerd: `runCron` reads the probes of sites/demo.json (seeded
 * into D1 as version 1), checks them through a mocked fetch, and applies the result through the ingest
 * engine into the migrated D1 and KV, where the read routes see it like any other source.
 */
import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CRON_EVERY_MINUTE, runCron } from "@/worker/cron";
import { createDb, schema } from "@/worker/db";
import { KvModelCache } from "@/worker/engine/kv-cache";
import { scheduled } from "@/worker/scheduled";
import { json, pipeline } from "../support/worker-pipeline";

const HEALTH = "https://example.com/api/healthz";
const WEB = "https://example.com/";
const T0 = Date.parse("2026-09-28T01:00:00Z");
const minute = (n: number) => T0 + n * 60_000;
const db = createDb(env.DB);

/** A fetch answering each configured URL with its current status; any other URL fails the test. */
function edge(statuses: Record<string, number>) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const status = statuses[String(url)];
    if (status === undefined) throw new Error("unexpected probe target");
    return new Response(null, { status });
  });
}

const run = (n: number, fetch: ReturnType<typeof edge>) =>
  runCron(env, { cron: CRON_EVERY_MINUTE, scheduledTime: minute(n) }, undefined, {
    fetch,
    sleep: async () => {},
    now: () => new Date(minute(n) + 4_000),
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
      opened: ["probe:web-app:2026-09-28T01:01:00Z"],
      resolved: [],
    });
    // The failing check was retried once before it counted as down.
    expect(down.mock.calls.filter(([url]) => String(url) === WEB)).toHaveLength(2);

    const third = await run(2, up);
    expect(third.probes).toMatchObject({ opened: [], resolved: ["probe:web-app:2026-09-28T01:01:00Z"] });

    expect((await beats("probe:web-app")).map((b) => [b.status, b.message])).toEqual([
      ["up", "HTTP 200"],
      ["down", "HTTP 503"],
      ["up", "HTTP 200"],
    ]);
    expect(await beats("probe:api-health")).toHaveLength(3);

    const services = await db
      .select({ id: schema.services.id, kind: schema.services.kind, target: schema.services.targetDisplay })
      .from(schema.services)
      .where(eq(schema.services.site, "demo"))
      .orderBy(asc(schema.services.id));
    expect(services).toEqual([
      { id: "probe:api-health", kind: "http", target: "example.com/api/healthz" },
      { id: "probe:web-app", kind: "http", target: "example.com/" },
    ]);

    const cached = await new KvModelCache(env.CACHE).get("demo");
    expect(cached?.services.map((s) => [s.id, s.status]).sort()).toEqual([
      ["probe:api-health", "up"],
      ["probe:web-app", "up"],
    ]);

    const { get, setNow } = pipeline(new Date(minute(2) + 30_000));
    const report = await json(await get("/api/sites/demo/sources"));
    expect(report.sources.find((s: { id: string }) => s.id === "probe:cf")).toMatchObject({
      kind: "probe",
      expectedIntervalS: 60,
      lastSeenAt: "2026-09-28T01:02:00Z",
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
    scheduled(
      createScheduledController({ cron: CRON_EVERY_MINUTE, scheduledTime: minute(20) }),
      env as unknown as Env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(logs.map((l) => JSON.parse(l))).toEqual([
      { evt: "cron", job: "probes", opened: 0, resolved: 0, sites: 1, checks: 2, down: 0, failedSites: 0 },
    ]);
  });
});
