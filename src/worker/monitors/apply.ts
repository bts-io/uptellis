/**
 * `applyResults`: the one entry point for check results, whoever ran them (the builtin runner in-process,
 * an agent over `POST /api/agent/v1/results`). For one (site, runner) call:
 *
 * 0. the site's sources are synced first (`syncSiteSources`: configured and implied runner sources), so a
 *    runner's first report finds its expected interval;
 * 1. each result is checked against the site's monitors (`monitorsOf`): the monitor exists, is enabled,
 *    lists this runner, is of a type this runner can run (`RUNNER_TYPES`), and the result is at most
 *    `MAX_RESULT_AGE_S` old and at most `MAX_RESULT_SKEW_S` ahead of `now`; anything else is `ignored`;
 * 2. the results apply in time order to the runner's state (`advanceRunner`); one that is not newer than
 *    the last applied one of its monitor (a resend, a duplicate) is `ignored`;
 * 3. after each applied result the monitor is confirmed across all its runners (`confirmMonitor`, with the
 *    other runners' stored states, as of the result's `ts`); that verdict is the result's heartbeat;
 * 4. each touched monitor becomes its Service `probe:<id>` with the verdict as of `now`, and everything
 *    goes in as ONE `ModelDelta` through `applyIngestDelta`, so heartbeats, `down` incidents, source
 *    freshness, `latest:<site>` and cards move exactly as for any ingest;
 * 5. the runner states are written (one batch) after the delta;
 * 6. convergence: the other runners' states are read again and the touched monitors confirmed once more;
 *    where the verdict differs from the one just written, one small correction delta (the Service and a
 *    heartbeat at `now`) follows.
 *
 * Sources. A monitor's Service keeps the source of its FIRST runner (`runnerSourceId`), so its freshness on
 * the page follows that runner. The delta, though, is applied for the REPORTING runner's source: its
 * `source` touch (and the ingest watermark) is `probe:<agent>` or the builtin source, so every runner's
 * freshness (and its `stale` incident) is its own. The store checks only that every row belongs to the
 * delta's site (`assertDeltaSite`); a service row whose `source` differs from the touched source is
 * accepted, and the delta's `generatedAt` is `now`, never a result's `ts`, so a flushed agent buffer is
 * never "outdated" for its own source. A call whose results were all ignored still touches the source:
 * the runner is alive.
 *
 * Concurrency: agents align their checks to the minute, so two runners of one monitor usually report in
 * the same second. Each request confirms with the other runner's state as it was loaded, which can be one
 * result behind (both requests see "only me confirmed" and write `degraded` while both are down). Step 6
 * fixes that within the request: runner states are saved one row per runner and D1 / SQLite apply writes
 * in order, so whichever request saves second reads both states and writes the verdict they agree on.
 *
 * Maintenance defaults to the site's windows (`inMaintenance` from src/shared/monitors), so a service in a
 * window confirms as `maintenance` and never opens an incident.
 *
 * Ordering and failure: the delta is written before the runner states. If the state write fails, a resend
 * applies the same results again from the same states (heartbeats and incidents are idempotent), so
 * nothing is lost; the reverse order could drop results that were marked applied but never stored.
 */
import type { SiteConfig } from "@/shared/config";
import { type Heartbeat, Service, type ServiceStatus } from "@/shared/model";
import {
  advanceRunner,
  BUILTIN_RUNNER,
  type CheckResult,
  confirmMonitor,
  MAX_RESULT_AGE_S,
  MAX_RESULT_SKEW_S,
  type MonitorConfig,
  monitorServiceId,
  monitorServiceKind,
  monitorsOf,
  monitorTargetDisplay,
  type ResultsAccepted,
  RUNNER_TYPES,
  type RunnerId,
  type RunnerRuntime,
  type RunnerState,
  runnerSourceId,
  inMaintenance as siteInMaintenance,
} from "@/shared/monitors";
import type { ModelDelta } from "@/shared/schemas";
import { isoSeconds } from "../adapters/common";
import { applyIngestDelta, type IngestBackend } from "../engine/ingest-service";
import { type ConfigSource, getSiteConfig, syncSiteSources } from "../engine/sites";
import type { MonitorRunnerState, RunnerStateStore } from "./runner-state";

/** Whether a service of the site is inside a maintenance window at `nowMs` (the alerting stream's rule). */
export type InMaintenance = (config: SiteConfig, serviceId: string, nowMs: number) => boolean;

export interface MonitorsBackend extends IngestBackend {
  configs: ConfigSource;
  runners: RunnerStateStore;
  /** Defaults to the site's maintenance windows (`inMaintenance` from src/shared/monitors). */
  inMaintenance?: InMaintenance;
}

export interface ApplyContext {
  site: string;
  runner: RunnerId;
  /** Where this instance runs (decides the builtin runner's source and types). */
  runtime: "cloudflare" | "docker";
}

export interface ApplyOutcome extends ResultsAccepted {
  /** The reporting runner's source. */
  source: string;
  /** Applied results whose own status was `down`. */
  down: number;
  incidents: { opened: string[]; resolved: string[] };
}

/** The runtime whose `RUNNER_TYPES` a runner uses: the instance's for `builtin`, `agent` otherwise. */
export const runnerRuntime = (runner: string, runtime: ApplyContext["runtime"]): RunnerRuntime =>
  runner === BUILTIN_RUNNER ? runtime : "agent";

/** True when `runner` can run monitors of `type` on this instance's runtime. */
export const runnerCanRun = (runner: string, type: MonitorConfig["type"], runtime: ApplyContext["runtime"]) =>
  RUNNER_TYPES[runnerRuntime(runner, runtime)].includes(type);

/** The monitor's runners that cannot run its type here (left out of confirmation). */
const unsupportedOf = (m: MonitorConfig, runtime: ApplyContext["runtime"]) =>
  new Set(m.runners.filter((r) => !runnerCanRun(r, m.type, runtime)));

const siteWindows: InMaintenance = (config, serviceId, nowMs) => siteInMaintenance(config, serviceId, nowMs);

export async function applyResults(
  backend: MonitorsBackend,
  ctx: ApplyContext,
  results: readonly CheckResult[],
  now: Date,
): Promise<ApplyOutcome> {
  const { site, runner, runtime } = ctx;
  const source = runnerSourceId(runner, runtime);
  const nowMs = now.getTime();
  const outcome: ApplyOutcome = {
    accepted: 0,
    ignored: 0,
    source,
    down: 0,
    incidents: { opened: [], resolved: [] },
  };
  const config = await getSiteConfig(backend.configs, site);
  if (!config) return { ...outcome, ignored: results.length };
  // Implied runner sources (expected intervals) before the first touch, as an ingest does; best effort.
  await syncSiteSources(backend.store, backend.configs, site, runtime).catch((err: unknown) =>
    console.warn(
      JSON.stringify({
        evt: "monitors",
        step: "sync_sources",
        name: err instanceof Error ? err.name : "unknown",
      }),
    ),
  );
  const inMaintenance = backend.inMaintenance ?? siteWindows;

  // 1. Eligible results, oldest first (stable for equal timestamps).
  const byId = new Map(monitorsOf(config).map((m) => [m.id, m]));
  const eligible: { monitor: MonitorConfig; result: CheckResult; ts: number }[] = [];
  for (const result of results) {
    const monitor = byId.get(result.monitorId);
    const ts = Date.parse(result.ts);
    const ok =
      !!monitor &&
      monitor.enabled &&
      monitor.runners.includes(runner) &&
      runnerCanRun(runner, monitor.type, runtime) &&
      !Number.isNaN(ts) &&
      nowMs - ts <= MAX_RESULT_AGE_S * 1000 &&
      ts - nowMs <= MAX_RESULT_SKEW_S * 1000;
    if (ok) eligible.push({ monitor, result, ts });
    else outcome.ignored++;
  }
  eligible.sort((a, b) => a.ts - b.ts);

  // 2 and 3. Advance the runner's state, confirm after each applied result.
  const touchedIds = [...new Set(eligible.map((e) => e.monitor.id))];
  const stored = touchedIds.length > 0 ? await backend.runners.load(site, touchedIds) : new Map();
  const states = new Map<string, RunnerState[]>(touchedIds.map((id) => [id, [...(stored.get(id) ?? [])]]));
  const previous = new Map(
    (touchedIds.length > 0 ? await backend.store.currentServices(site) : []).map((s) => [s.id, s]),
  );
  const lastStatus = new Map<string, ServiceStatus | undefined>(
    touchedIds.map((id) => [id, previous.get(monitorServiceId(id))?.status]),
  );
  const applied = new Map<string, CheckResult[]>();
  const heartbeats: Heartbeat[] = [];
  const confirm = (m: MonitorConfig, at: number) =>
    confirmMonitor(m, states.get(m.id) ?? [], {
      nowMs: at,
      inMaintenance: inMaintenance(config, monitorServiceId(m.id), at),
      unsupported: unsupportedOf(m, runtime),
    });

  for (const { monitor, result, ts } of eligible) {
    const list = states.get(monitor.id)!;
    const i = list.findIndex((s) => s.runner === runner);
    const next = advanceRunner(i >= 0 ? list[i] : undefined, runner, result);
    if (!next) {
      outcome.ignored++;
      continue;
    }
    if (i >= 0) list[i] = next;
    else list.push(next);
    outcome.accepted++;
    if (result.status === "down") outcome.down++;
    applied.set(monitor.id, [...(applied.get(monitor.id) ?? []), result]);

    const verdict = confirm(monitor, ts);
    heartbeats.push({
      site,
      serviceId: monitorServiceId(monitor.id),
      ts: isoSeconds(ts),
      status: verdict.status,
      latencyMs: verdict.latencyMs,
      message: verdict.message,
      important: verdict.status !== lastStatus.get(monitor.id),
    });
    lastStatus.set(monitor.id, verdict.status);
  }

  // 4. One Service per touched monitor, as of now; one delta for the reporting runner's source.
  const services: Service[] = [];
  const savedStates: MonitorRunnerState[] = [];
  for (const id of touchedIds) {
    const done = applied.get(id);
    if (!done) continue;
    const monitor = byId.get(id)!;
    savedStates.push({ monitorId: id, state: states.get(id)!.find((s) => s.runner === runner)! });
    services.push(
      serviceOf(site, monitor, confirm(monitor, nowMs), done, previous.get(monitorServiceId(id)), runtime),
    );
  }
  const at = isoSeconds(now);
  const delta: ModelDelta = {
    site,
    generatedAt: at,
    source: { sourceId: source, seenAt: at, ok: true, error: null },
    services,
    heartbeats,
    facts: [],
  };
  const ingest = await applyIngestDelta(backend, { site, source }, delta, now);
  outcome.incidents = ingest.incidents;

  // 5. The runner states, after the delta (see the header).
  if (savedStates.length === 0) return outcome;
  await backend.runners.save(site, savedStates);

  // 6. Converge with runners that saved in between (see the header).
  const fresh = await backend.runners.load(site, [...applied.keys()]);
  const fixes: Service[] = [];
  const beats: Heartbeat[] = [];
  for (const [id, done] of applied) {
    const monitor = byId.get(id)!;
    const written = services.find((s) => s.id === monitorServiceId(id));
    const verdict = confirmMonitor(monitor, fresh.get(id) ?? [], {
      nowMs,
      inMaintenance: inMaintenance(config, monitorServiceId(id), nowMs),
      unsupported: unsupportedOf(monitor, runtime),
    });
    if (!written || verdict.status === written.status) continue;
    fixes.push(serviceOf(site, monitor, verdict, done, previous.get(monitorServiceId(id)), runtime));
    beats.push({
      site,
      serviceId: monitorServiceId(id),
      ts: at,
      status: verdict.status,
      latencyMs: verdict.latencyMs,
      message: verdict.message,
      important: true,
    });
  }
  if (fixes.length > 0) {
    const again = await applyIngestDelta(
      backend,
      { site, source },
      { ...delta, services: fixes, heartbeats: beats },
      now,
    );
    outcome.incidents = {
      opened: [...outcome.incidents.opened, ...again.incidents.opened],
      resolved: [...outcome.incidents.resolved, ...again.incidents.resolved],
    };
  }
  return outcome;
}

function serviceOf(
  site: string,
  m: MonitorConfig,
  verdict: ReturnType<typeof confirmMonitor>,
  applied: readonly CheckResult[],
  before: Service | undefined,
  runtime: ApplyContext["runtime"],
): Service {
  const cert = applied.findLast((r) => r.cert)?.cert ?? before?.cert;
  return Service.parse({
    id: monitorServiceId(m.id),
    site,
    source: runnerSourceId(m.runners[0]!, runtime),
    externalId: m.id,
    name: m.name,
    kind: monitorServiceKind(m),
    targetDisplay: monitorTargetDisplay(m),
    intervalS: m.intervalS,
    ...(m.type === "http" ? { method: m.method } : {}),
    timeoutS: m.timeoutS,
    status: verdict.status,
    latencyMs: verdict.latencyMs,
    avgLatencyMs: before?.avgLatencyMs ?? null,
    uptime24h: before?.uptime24h ?? null,
    uptime30d: before?.uptime30d ?? null,
    ...(m.type === "tls" && cert ? { cert } : {}),
  });
}
