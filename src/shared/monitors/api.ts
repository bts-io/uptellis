/**
 * Phase 6 contract (lead): check results and the agent API. The builtin runner hands its results to the
 * same entry point in-process; an agent uses HTTP:
 *
 * `GET  /api/agent/v1/monitors`  the monitors this agent runs (ETag; `If-None-Match` -> 304).
 * `POST /api/agent/v1/results`   a batch of results, oldest first -> 202 `ResultsAccepted`.
 *
 * Both need `Authorization: Bearer upt_<id>_<secret>` of a site API key with the `agent` scope, and
 * `X-Uptellis-Runner: <agent id>` naming an agent declared in that site's `agents`. Errors: 400 invalid
 * body, 401 bad or revoked key, 403 missing scope or unknown runner, 413 over `MAX_RESULTS_BYTES`, 429 rate
 * limited (the agent backs off and keeps its buffer). A result is identified by (monitor, runner, ts):
 * resending one is harmless, so an agent resends its buffer until a 202 covers it.
 */
import { z } from "zod";
import { IsoTimestamp, Milliseconds, ShortMessage, SiteSlug } from "../model/common";
import { CertSummary } from "../model/service";
import { AgentId, MonitorConfig } from "./schema";

export const AGENT_API_PREFIX = "/api/agent/v1";
export const RUNNER_HEADER = "X-Uptellis-Runner";
export const MAX_RESULTS_PER_BATCH = 500;
export const MAX_RESULTS_BYTES = 256 * 1024;
/** Results older than this are refused as `ignored` (raw heartbeats are kept 26 h). */
export const MAX_RESULT_AGE_S = 24 * 60 * 60;
/** Clock skew tolerated into the future. */
export const MAX_RESULT_SKEW_S = 60;

export const CHECK_STATUSES = ["up", "down", "degraded"] as const;
export const CheckStatus = z.enum(CHECK_STATUSES);
export type CheckStatus = z.infer<typeof CheckStatus>;

/** One finished check by one runner. */
export const CheckResult = z.object({
  monitorId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  /** When the check started (whole seconds, UTC). */
  ts: IsoTimestamp,
  /** `degraded`: answered but not healthy (TLS certificate close to expiry). */
  status: CheckStatus,
  /** Time to the response, connection or echo; null when nothing answered. */
  latencyMs: Milliseconds.nullable(),
  /** Short and display-safe: `HTTP 200`, `timeout`, `connection refused`, `keyword missing`, `12 days left`. */
  message: ShortMessage,
  /** TLS monitors only. */
  cert: CertSummary.optional(),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const AgentMonitorsResponse = z.object({
  v: z.literal(1),
  site: SiteSlug,
  runner: AgentId,
  generatedAt: IsoTimestamp,
  /** Enabled monitors listing this agent among their runners. */
  monitors: z.array(MonitorConfig),
  /** How often to poll this endpoint and to flush results. */
  pollS: z.number().int().min(15).max(3600),
});
export type AgentMonitorsResponse = z.infer<typeof AgentMonitorsResponse>;

export const ResultsBatch = z.object({
  v: z.literal(1),
  /** e.g. `uptellis-agent/0.3.0`. */
  agent: z.string().regex(/^[A-Za-z0-9._/+-]{1,64}$/),
  sentAt: IsoTimestamp,
  results: z.array(CheckResult).min(1).max(MAX_RESULTS_PER_BATCH),
});
export type ResultsBatch = z.infer<typeof ResultsBatch>;

export const ResultsAccepted = z.object({
  /** Applied to the runner's state (newer than the last applied result of that monitor). */
  accepted: z.number().int().nonnegative(),
  /** Duplicates, unknown or not-assigned monitors, too old or too far in the future: dropped, never retried. */
  ignored: z.number().int().nonnegative(),
});
export type ResultsAccepted = z.infer<typeof ResultsAccepted>;
