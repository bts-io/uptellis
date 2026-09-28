/**
 * The scheduled jobs (`JOBS` in src/platform/types.ts): `probes` every minute (the builtin monitor runner,
 * src/worker/monitors/builtin.ts), `fiveMinute` every 5 minutes, `daily` once a day. Cloudflare maps each
 * Cron Trigger to its job (src/platform/cloudflare/scheduled.ts), Docker runs them from its own scheduler
 * (src/platform/docker/scheduler.ts); both call `runJob` through `runScheduledJob` (./scheduled.ts).
 */
import { lt, sql } from "drizzle-orm";
import type { JobName, Platform } from "@/platform/types";
import type { Incident } from "@/shared/model";
import { type Db, schema } from "@/worker/db";
import { changesOf, toIso } from "@/worker/db/util";
import { D1ConfigStore } from "@/worker/engine/config-store";
import { D1Store } from "@/worker/engine/d1-store";
import { KvModelCache } from "@/worker/engine/kv-cache";
import { syncSiteSources } from "@/worker/engine/sites";
import { type BuiltinRun, type BuiltinRunOptions, runBuiltin } from "@/worker/monitors/builtin";
import { legacyRunCheck, legacyTransport } from "@/worker/monitors/legacy-check";
import { SqlRunnerStates } from "@/worker/monitors/runner-state";
import { staleNotifier } from "@/worker/notify";
import pkg from "../../package.json";

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
  job: JobName;
  downsampled?: { from: number; to: number };
  opened?: Incident[];
  resolved?: Incident[];
  pruned?: Record<string, number>;
  probes?: BuiltinRun;
}

/** What the `probes` job checks with; each defaults to the runtime's own. */
export type ProbeJobOptions = Partial<BuiltinRunOptions>;

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

/**
 * Deletes rows past retention, and expired `kv` entries (the Docker cache; always empty on D1), in one
 * batch. Open incidents are never pruned.
 */
export async function prune(
  platform: Pick<Platform, "db" | "batch">,
  nowMs: number,
): Promise<Record<string, number>> {
  const { heartbeats, heartbeat5m, factSamples, snapshots, ingestNonces, incidents, kv } = schema;
  const { db } = platform;
  const results = await platform.batch([
    db.delete(heartbeats).where(lt(heartbeats.ts, nowMs - RETENTION_MS.heartbeats)),
    db.delete(heartbeat5m).where(lt(heartbeat5m.bucket, nowMs - RETENTION_MS.heartbeat5m)),
    db.delete(factSamples).where(lt(factSamples.ts, nowMs - RETENTION_MS.factSamples)),
    db.delete(snapshots).where(lt(snapshots.receivedAt, nowMs - RETENTION_MS.snapshots)),
    db.delete(ingestNonces).where(lt(ingestNonces.expiresAt, nowMs)),
    db.delete(incidents).where(lt(incidents.endedAt, nowMs - RETENTION_MS.incidents)),
    db.delete(kv).where(lt(kv.expiresAt, nowMs)),
  ]);
  const names = ["heartbeats", "heartbeat5m", "factSamples", "snapshots", "ingestNonces", "incidents", "kv"];
  return Object.fromEntries(names.map((n, i) => [n, changesOf(results[i])]));
}

/**
 * Runs one job at its scheduled time. The five-minute job hands its `stale` transitions to the Discord
 * notifier (when the `DISCORD_WEBHOOK_URL` secret is set), which sends inside the platform's `waitUntil`.
 */
export async function runJob(
  platform: Platform,
  job: JobName,
  scheduledTime: number,
  probeOptions: ProbeJobOptions = {},
): Promise<CronResult> {
  const { db } = platform;
  const now = scheduledTime;
  const configs = new D1ConfigStore(platform);
  const store = new D1Store(platform);
  const cache = new KvModelCache(platform.kv);

  switch (job) {
    case "probes": {
      const backend = {
        store,
        cache,
        configs,
        runtime: platform.runtime,
        runners: new SqlRunnerStates(platform),
        // A probe source coming back resolves its stale incident here: that recovery gets its card too.
        notifier: staleNotifier(platform, configs, { now: () => now }),
      };
      const probes = await runBuiltin(backend, platform.runtime, now, {
        // TODO(p6-integration): switch to src/checks (`runCheck` and the runtime's `CheckTransport`).
        runCheck: legacyRunCheck,
        transport: legacyTransport,
        version: pkg.version,
        ...probeOptions,
      });
      return { job, probes };
    }
    case "fiveMinute": {
      const downsampled = await downsample(db, now);
      const opened: Incident[] = [];
      const resolved: Incident[] = [];
      const notifier = staleNotifier(platform, configs, { now: () => now });
      // Configured sites get their sources (expected intervals) written before the sweep reads them.
      for (const site of await configs.slugs()) {
        await syncSiteSources(store, configs, site, platform.runtime).catch((err: unknown) =>
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
      return { job, downsampled, opened, resolved };
    }
    case "daily":
      return { job, pruned: await prune(platform, now) };
  }
}
