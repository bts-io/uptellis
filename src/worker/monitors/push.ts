/**
 * Push monitors (heartbeats): a job proves it is alive by calling its push URL (src/worker/routes/push.ts);
 * when the calls stop, this module's silent rule marks it down. Both hand their results to `applyResults`
 * as runner `push` (`PUSH_RUNNER`, source `PUSH_SOURCE_ID`), so incidents, cards, maintenance windows and
 * heartbeats work as for any monitor, and `confirmMonitor` confirms each result at once (one runner, no
 * retries, no quorum; src/shared/monitors/confirm.ts).
 *
 * The silent rule runs in the every-minute `probes` job, per site and enabled push monitor:
 *
 * - Clock: silence counts from the last push, or from `watchSince`, when the job first saw the monitor
 *   enabled (its creation, or enabling it again after a pause), whichever is later. A monitor that never
 *   received a push therefore goes down `intervalS + graceS` after it was created, not at once. Until its
 *   first push it shows `pending` ("waiting for a push").
 * - Transition: once `intervalS + graceS` passed without a push, ONE `down` result ("no push for 5 min") is
 *   applied. While it stays silent no further result is written: the runner state already holds that `down`
 *   (newer than the clock's start) and the service is `down`. Only a heartbeat is added, once per interval
 *   and never important, so the beat bars and the uptime count the silent time as down, as they would for a
 *   monitor whose checks keep failing. Inside a maintenance window the result confirms as `maintenance` (no
 *   incident, no card) and the heartbeats are `maintenance`; when the window ends while it is still silent,
 *   one more `down` result follows, which opens the incident and sends the card.
 * - The next push brings it up (an `up` card as usual).
 * - Paused (`enabled: false`): the clock stops and the service shows `paused`; enabling it again restarts
 *   the clock from that minute.
 * - Removed: the rows (and tokens) of monitors a newer config version no longer has as push monitors are
 *   deleted, so the old URL stays dead even if the id comes back. The version check keeps a job that read
 *   an older cached config from deleting a token issued against a newer one.
 *
 * A write can lose to a push that arrived between the minute's start and the job (the delta is then older
 * than the push source's last one and its services are skipped); the next minute applies it again.
 */
import type { Runtime } from "@/platform/types";
import type { Heartbeat, Service, ServiceStatus } from "@/shared/model";
import {
  type CheckResult,
  formatSeconds,
  monitorServiceId,
  monitorsOf,
  PUSH_RUNNER,
  PUSH_SOURCE_ID,
  type PushMonitor,
  inMaintenance as siteInMaintenance,
} from "@/shared/monitors";
import { isoSeconds } from "../adapters/common";
import { applyIngestDelta } from "../engine/ingest-service";
import { applyResults, type MonitorsBackend, serviceOf } from "./apply";
import type { PushTokenStore } from "./push-store";

/** Where push monitors live (the `push_tokens` table in the app; see ./push-store.ts). */
export type PushStore = Pick<PushTokenStore, "watches" | "arm" | "disarm" | "forget">;

export interface PushBackend extends MonitorsBackend {
  pushes: PushStore;
}

export interface PushWatchRun {
  /** Sites with push monitors (or rows of removed ones). */
  sites: number;
  /** Silent monitors marked down this minute. */
  down: number;
  opened: string[];
  resolved: string[];
  failedSites: number;
}

/** The status message while waiting for a monitor's first push. */
export const WAITING_MESSAGE = "waiting for a push";

/** `no push for 5 min`: whole minutes of silence. */
export const silentMessage = (silentMs: number) =>
  `no push for ${formatSeconds(Math.max(60, Math.floor(silentMs / 60_000) * 60))}`;

/** A silent monitor gets one heartbeat per interval (every minute at 60 s), on minutes aligned to the epoch. */
const beatDue = (m: PushMonitor, nowMs: number) =>
  Math.floor(nowMs / 60_000) % Math.max(1, Math.round(m.intervalS / 60)) === 0;

const verdict = (status: ServiceStatus, message: string) => ({
  status,
  latencyMs: null,
  message,
  downRunners: [],
});

/** Runs the silent rule for every site at `nowMs` (the job's scheduled minute). */
export async function watchPushMonitors(
  backend: PushBackend,
  runtime: Runtime,
  nowMs: number,
): Promise<PushWatchRun> {
  const run: PushWatchRun = { sites: 0, down: 0, opened: [], resolved: [], failedSites: 0 };
  for (const site of await backend.configs.slugs()) {
    try {
      const out = await watchSite(backend, runtime, site, nowMs);
      if (!out) continue;
      run.sites++;
      run.down += out.down;
      run.opened.push(...out.opened);
      run.resolved.push(...out.resolved);
    } catch (err) {
      run.failedSites++;
      console.warn(
        JSON.stringify({
          evt: "push",
          step: "watch",
          site,
          name: err instanceof Error ? err.name : "unknown",
        }),
      );
    }
  }
  return run;
}

async function watchSite(backend: PushBackend, runtime: Runtime, site: string, nowMs: number) {
  const state = await backend.configs.current(site);
  if (!state) return null;
  const { config, version } = state;
  const pushes = monitorsOf(config).filter((m): m is PushMonitor => m.type === "push");
  const watches = await backend.pushes.watches(site);
  if (pushes.length === 0 && watches.length === 0) return null;

  const ids = new Set(pushes.map((m) => m.id));
  await backend.pushes.forget(
    site,
    watches.filter((w) => !ids.has(w.monitorId) && w.configVersion < version).map((w) => w.monitorId),
  );
  const byId = new Map(watches.map((w) => [w.monitorId, w]));
  const runnerStates = ids.size > 0 ? await backend.runners.load(site, [...ids]) : new Map();
  const services = new Map((await backend.store.currentServices(site)).map((s) => [s.id, s]));
  const inWindow = backend.inMaintenance ?? siteInMaintenance;

  const results: CheckResult[] = [];
  const quiet: Service[] = [];
  const beats: Heartbeat[] = [];
  for (const m of pushes) {
    const serviceId = monitorServiceId(m.id);
    const watch = byId.get(m.id);
    const before = services.get(serviceId);
    if (!m.enabled) {
      if (watch && watch.watchSince !== null) await backend.pushes.disarm(site, m.id);
      if (before && before.status !== "paused") {
        quiet.push(serviceOf(site, m, verdict("paused", "paused"), [], before, runtime));
      }
      continue;
    }
    if (!watch || watch.watchSince === null) {
      await backend.pushes.arm(site, m.id, version, nowMs);
      if (!before || before.status === "paused") {
        quiet.push(serviceOf(site, m, verdict("pending", WAITING_MESSAGE), [], before, runtime));
      }
      continue;
    }
    const since = Math.max(watch.watchSince, watch.lastPushAt ?? 0);
    const silentMs = nowMs - since;
    if (silentMs < (m.intervalS + m.graceS) * 1000) continue;

    const message = silentMessage(silentMs);
    const last = (runnerStates.get(m.id) ?? []).find((s: { runner: string }) => s.runner === PUSH_RUNNER);
    // A `down` recorded since the clock started (result timestamps are whole seconds).
    const recorded = last?.lastStatus === "down" && last.lastTs >= Math.floor(since / 1000) * 1000;
    const maint = inWindow(config, serviceId, nowMs);
    if (recorded && (before?.status === "down" || maint)) {
      if (beatDue(m, nowMs)) {
        beats.push({
          site,
          serviceId,
          ts: isoSeconds(nowMs),
          status: maint ? "maintenance" : "down",
          latencyMs: null,
          message,
          important: false,
        });
      }
      continue;
    }
    results.push({ monitorId: m.id, ts: isoSeconds(nowMs), status: "down", latencyMs: null, message });
  }

  const out = { down: 0, opened: [] as string[], resolved: [] as string[] };
  const now = new Date(nowMs);
  if (results.length > 0) {
    const applied = await applyResults(backend, { site, runner: PUSH_RUNNER, runtime }, results, now);
    out.down = applied.accepted;
    out.opened.push(...applied.incidents.opened);
    out.resolved.push(...applied.incidents.resolved);
  }
  if (quiet.length + beats.length > 0) {
    const at = isoSeconds(nowMs);
    const ingest = await applyIngestDelta(
      backend,
      { site, source: PUSH_SOURCE_ID },
      {
        site,
        generatedAt: at,
        source: { sourceId: PUSH_SOURCE_ID, seenAt: at, ok: true, error: null },
        services: quiet,
        heartbeats: beats,
        facts: [],
      },
      now,
    );
    out.opened.push(...ingest.incidents.opened);
    out.resolved.push(...ingest.incidents.resolved);
  }
  return out;
}
