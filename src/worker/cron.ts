/**
 * Scheduled handler body (the lead wires `scheduled` in src/server.ts to `runCron`). The job is picked by
 * the trigger's cron expression, so every trigger must match `wrangler.jsonc` exactly.
 */
import { lt, sql } from "drizzle-orm";
import type { Incident } from "@/shared/model";
import { createDb, type Db, schema } from "@/worker/db";
import { toIso } from "@/worker/db/util";
import { D1ConfigStore } from "@/worker/engine/config-store";
import { D1Store } from "@/worker/engine/d1-store";
import { KvModelCache } from "@/worker/engine/kv-cache";
import { syncSiteSources } from "@/worker/engine/sites";
import { staleNotifier } from "@/worker/notify";
import { type ProbeRun, type ProbeRunOptions, runProbes } from "@/worker/probes/scheduler";

export const CRON_EVERY_5_MIN = "*/5 * * * *";
export const CRON_DAILY = "17 3 * * *";
export const CRON_EVERY_MINUTE = "* * * * *";

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

export const BUCKET_MS = 5 * MIN_MS;
/**
 * Finished windows re-folded on every run. Late heartbeats (the collector's 60 min ring buffer) land in
 * windows that were already folded; recomputing them from raw rows keeps the rollup exact.
 */
export const DOWNSAMPLE_LOOKBACK_MS = 2 * HOUR_MS;

export const RETENTION_MS = {
  heartbeats: 26 * HOUR_MS,
  heartbeat5m: 90 * DAY_MS,
  factSamples: 90 * DAY_MS,
  snapshots: 7 * DAY_MS,
  incidents: 365 * DAY_MS,
} as const;

export interface CronResult {
  job: "five-minute" | "daily" | "probes" | "unknown";
  downsampled?: { from: number; to: number };
  opened?: Incident[];
  resolved?: Incident[];
  pruned?: Record<string, number>;
  probes?: ProbeRun;
}

/**
 * Folds the finished 5-minute windows in `[end - lookback, end)` into `heartbeat_5m`, where `end` is the
 * start of the current (unfinished) window. One INSERT ... SELECT ... GROUP BY ... ON CONFLICT DO UPDATE.
 */
export async function downsample(db: Db, nowMs: number, lookbackMs = DOWNSAMPLE_LOOKBACK_MS) {
  const to = Math.floor(nowMs / BUCKET_MS) * BUCKET_MS;
  // A literal, not a bound parameter: D1 binds JS numbers as REAL, which would turn the division into a
  // float division instead of flooring to the window start.
  const width = sql.raw(String(BUCKET_MS));
  const from = to - lookbackMs;
  await db.run(sql`
    insert into heartbeat_5m (site, service_id, bucket, total, up, down, maint, pending, ping_avg, ping_max)
    select site, service_id, (ts / ${width}) * ${width} as bucket, count(*),
      sum(status = 'up'), sum(status = 'down'), sum(status = 'maintenance'), sum(status = 'pending'),
      avg(latency_ms), max(latency_ms)
    from heartbeats
    where ts >= ${from} and ts < ${to}
    group by site, service_id, bucket
    on conflict (site, service_id, bucket) do update set
      total = excluded.total, up = excluded.up, down = excluded.down, maint = excluded.maint,
      pending = excluded.pending, ping_avg = excluded.ping_avg, ping_max = excluded.ping_max
  `);
  return { from, to };
}

/** Deletes rows past retention in one batch. Open incidents are never pruned. */
export async function prune(db: Db, nowMs: number): Promise<Record<string, number>> {
  const { heartbeats, heartbeat5m, factSamples, snapshots, ingestNonces, incidents } = schema;
  const results = await db.batch([
    db.delete(heartbeats).where(lt(heartbeats.ts, nowMs - RETENTION_MS.heartbeats)),
    db.delete(heartbeat5m).where(lt(heartbeat5m.bucket, nowMs - RETENTION_MS.heartbeat5m)),
    db.delete(factSamples).where(lt(factSamples.ts, nowMs - RETENTION_MS.factSamples)),
    db.delete(snapshots).where(lt(snapshots.receivedAt, nowMs - RETENTION_MS.snapshots)),
    db.delete(ingestNonces).where(lt(ingestNonces.expiresAt, nowMs)),
    db.delete(incidents).where(lt(incidents.endedAt, nowMs - RETENTION_MS.incidents)),
  ]);
  const names = ["heartbeats", "heartbeat5m", "factSamples", "snapshots", "ingestNonces", "incidents"];
  return Object.fromEntries(names.map((n, i) => [n, results[i]?.meta.changes ?? 0]));
}

/**
 * Runs the job for `event.cron`. The five-minute job hands its `stale` transitions to the Discord notifier
 * (when `DISCORD_WEBHOOK_URL` is set), which sends inside `ctx.waitUntil` when given one.
 */
export async function runCron(
  env: Pick<Env, "DB" | "CACHE"> & Partial<Pick<Env, "DISCORD_WEBHOOK_URL">>,
  event: Pick<ScheduledController, "cron" | "scheduledTime">,
  ctx?: Pick<ExecutionContext, "waitUntil">,
  probeOptions: ProbeRunOptions = {},
): Promise<CronResult> {
  const db = createDb(env.DB);
  const now = event.scheduledTime;

  if (event.cron === CRON_EVERY_MINUTE) {
    const configs = new D1ConfigStore(db, env.CACHE);
    const backend = {
      store: new D1Store(db),
      cache: new KvModelCache(env.CACHE),
      configs,
      // A probe source coming back resolves its stale incident here: that recovery gets its card too.
      notifier: staleNotifier(env, configs, { ctx, now: () => now }) ?? undefined,
    };
    return { job: "probes", probes: await runProbes(backend, now, probeOptions) };
  }

  if (event.cron === CRON_EVERY_5_MIN) {
    const downsampled = await downsample(db, now);
    const store = new D1Store(db);
    const cache = new KvModelCache(env.CACHE);
    const opened: Incident[] = [];
    const resolved: Incident[] = [];
    // Configured sites get their sources (expected intervals) written before the sweep reads them.
    const configs = new D1ConfigStore(db, env.CACHE);
    const notifier = staleNotifier(env, configs, { ctx, now: () => now });
    for (const site of await configs.slugs()) {
      await syncSiteSources(store, configs, site).catch((err: unknown) =>
        console.warn(
          JSON.stringify({
            evt: "cron",
            step: "sync_sources",
            name: err instanceof Error ? err.name : "unknown",
          }),
        ),
      );
    }
    for (const site of await store.listSites()) {
      const r = await store.sweepStaleness(site, toIso(now));
      opened.push(...r.incidentsOpened);
      resolved.push(...r.incidentsResolved);
      await notifier?.notify(site, { opened: r.incidentsOpened, resolved: r.incidentsResolved });
      // Keep latest:<site> in step when a stale incident opened or closed.
      if (r.incidentsOpened.length + r.incidentsResolved.length > 0) {
        await cache.put(await store.loadSiteModel(site, toIso(now)));
      }
    }
    return { job: "five-minute", downsampled, opened, resolved };
  }

  if (event.cron === CRON_DAILY) {
    return { job: "daily", pruned: await prune(db, now) };
  }

  console.warn("cron: no job for this trigger");
  return { job: "unknown" };
}
