/**
 * Phase 6 contract (lead): how runner results become one service status (pure; the `monitors` stream calls
 * it after every applied result, and nowhere else decides a monitor's status).
 *
 * Per runner (`advanceRunner`): results apply in time order; `consecutiveDown` counts `down` checks in a
 * row. A runner is *failing* on its first `down` and *confirmed down* once `consecutiveDown > retries`.
 *
 * Per monitor (`confirmMonitor`), over the runners that can run its type and reported within
 * `freshWindowMs` (fresh):
 * 1. disabled -> `paused`; inside a maintenance window -> `maintenance` (no incident, no card);
 * 2. no fresh runner -> `unknown`;
 * 3. confirmed-down runners >= min(quorum, fresh runners) -> `down`. A silent runner never blocks a
 *    verdict: with an agent offline, the remaining runners decide (the agent raises its own stale incident);
 * 4. some but too few confirmed down -> `degraded` ("down from office-1"): visible, never paged;
 * 5. any runner failing but not yet confirmed -> `pending`;
 * 6. any runner `degraded` (e.g. a certificate close to expiry) -> `degraded`; else `up`.
 * Only `down` opens an incident and only the transitions into and out of `down` send cards.
 *
 * A push monitor is confirmed the same way with one runner (`PUSH_RUNNER`), no retries and no quorum, and
 * its results never go out of date: each push is final, and silence is not "no recent results" but a
 * `down` result of its own, written by the silent rule (src/worker/monitors/push.ts).
 */
import type { ServiceStatus } from "../model/common";
import type { CheckResult, CheckStatus } from "./api";
import {
  effectiveQuorum,
  type MonitorConfig,
  PUSH_RUNNER,
  type PushMonitor,
  type RunnerMonitorConfig,
} from "./schema";

export interface RunnerState {
  runner: string;
  /** Epoch ms of the last applied result. */
  lastTs: number;
  lastStatus: CheckStatus;
  consecutiveDown: number;
  latencyMs: number | null;
  message: string;
}

export interface Verdict {
  status: ServiceStatus;
  latencyMs: number | null;
  message: string;
  /** Runners confirmed down, in config order. */
  downRunners: string[];
}

/** A runner counts while its last result is within three intervals plus a minute (agents flush every minute). */
export const freshWindowMs = (m: Pick<MonitorConfig, "intervalS">) => (3 * m.intervalS + 60) * 1000;

/** The runner's state after one more result, or null when the result is not newer than the last applied. */
export function advanceRunner(
  prev: RunnerState | undefined,
  runner: string,
  result: Pick<CheckResult, "ts" | "status" | "latencyMs" | "message">,
): RunnerState | null {
  const ts = Date.parse(result.ts);
  if (prev && ts <= prev.lastTs) return null;
  return {
    runner,
    lastTs: ts,
    lastStatus: result.status,
    consecutiveDown: result.status === "down" ? (prev?.consecutiveDown ?? 0) + 1 : 0,
    latencyMs: result.latencyMs,
    message: result.message,
  };
}

export interface ConfirmContext {
  nowMs: number;
  inMaintenance: boolean;
  /** Runners that cannot run this monitor's type (e.g. `builtin` for ping on Cloudflare); left out entirely. */
  unsupported?: ReadonlySet<string>;
}

/** What confirmation reads of a monitor: runners, quorum and retries, or the push monitor itself. */
export type ConfirmTarget =
  | Pick<RunnerMonitorConfig, "runners" | "quorum" | "retries" | "intervalS" | "enabled">
  | Pick<PushMonitor, "type" | "intervalS" | "enabled">;

/** Push monitors as confirmation sees them: one runner, no retries, no quorum, results that never expire. */
function confirmSpec(m: ConfirmTarget) {
  if ("type" in m && m.type === "push") {
    return { runners: [PUSH_RUNNER], retries: 0, quorum: undefined, freshMs: Number.POSITIVE_INFINITY };
  }
  const r = m as Pick<RunnerMonitorConfig, "runners" | "quorum" | "retries" | "intervalS">;
  return { runners: r.runners, retries: r.retries, quorum: r.quorum, freshMs: freshWindowMs(r) };
}

export function confirmMonitor(
  m: ConfirmTarget,
  states: readonly RunnerState[],
  ctx: ConfirmContext,
): Verdict {
  const none = (status: ServiceStatus, message: string): Verdict => ({
    status,
    latencyMs: null,
    message,
    downRunners: [],
  });
  if (!m.enabled) return none("paused", "paused");
  if (ctx.inMaintenance) return none("maintenance", "maintenance");
  const spec = confirmSpec(m);
  const runners = spec.runners.filter((r) => !ctx.unsupported?.has(r));
  const byRunner = new Map(states.map((s) => [s.runner, s]));
  const fresh = runners
    .map((r) => byRunner.get(r))
    .filter((s): s is RunnerState => !!s && ctx.nowMs - s.lastTs <= spec.freshMs);
  if (fresh.length === 0) return none("unknown", "no recent results");

  const multi = runners.length > 1;
  const label = (s: RunnerState) => (multi ? `${s.runner}: ${s.message}` : s.message).slice(0, 200);
  const down = fresh.filter((s) => s.lastStatus === "down" && s.consecutiveDown > spec.retries);
  const failing = fresh.filter((s) => s.lastStatus === "down" && s.consecutiveDown <= spec.retries);
  const need = Math.min(effectiveQuorum({ runners, quorum: spec.quorum }), fresh.length);
  const downRunners = down.map((s) => s.runner);

  if (down.length >= need) return { status: "down", latencyMs: null, message: label(down[0]!), downRunners };
  if (down.length > 0) {
    return {
      status: "degraded",
      latencyMs: null,
      message: `down from ${downRunners.join(", ")}`,
      downRunners,
    };
  }
  if (failing.length > 0)
    return { status: "pending", latencyMs: null, message: label(failing[0]!), downRunners };
  const degraded = fresh.find((s) => s.lastStatus === "degraded");
  const lead = degraded ?? fresh[0]!;
  return {
    status: degraded ? "degraded" : "up",
    latencyMs: lead.latencyMs,
    message: label(lead),
    downRunners,
  };
}
