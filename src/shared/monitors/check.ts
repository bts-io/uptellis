/**
 * Phase 6 contract (lead): the check library every runner shares (the `checkers` stream implements it in
 * src/checks/). The checks themselves are pure over a `CheckTransport`; each runtime supplies one:
 * Workers (`fetch`, `cloudflare:sockets`) in src/platform/cloudflare/, Bun (`fetch`, `node:net`,
 * `node:tls`, the system `ping`) in src/checks/bun-transport.ts for Docker and the agent.
 *
 * Behaviour every runner relies on:
 * - an attempt that is not `up` is retried once after `RETRY_DELAY_MS` within the same check (a blip is
 *   never reported); `retries` in the config counts whole checks and is applied by confirmation;
 * - `runCheck` never throws: every failure is a `down` result with a short display-safe message;
 * - HTTP never follows redirects, sends `user-agent: uptellis/<version>`, and reads at most 64 KiB of the
 *   body, only for a keyword;
 * - a transport without a capability (`ping`, `tls` on Workers) is never called for it: the runner skips
 *   monitors whose type is not in its `RUNNER_TYPES`.
 */
import type { CertSummary } from "../model/service";
import type { CheckResult } from "./api";
import type { MonitorConfig } from "./schema";

export const RETRY_DELAY_MS = 2000;
export const KEYWORD_BODY_LIMIT = 64 * 1024;

export interface TcpProbe {
  latencyMs: number;
}

export interface TlsProbe {
  latencyMs: number;
  /** Chain valid for the name (hostname or `servername`). */
  authorized: boolean;
  cert: CertSummary;
}

/** Network primitives; each rejects on failure with an Error whose `name` is `TimeoutError` on timeout. */
export interface CheckTransport {
  fetch: typeof fetch;
  tcp(host: string, port: number, timeoutMs: number): Promise<TcpProbe>;
  /** Absent where ICMP is unavailable. Resolves the round trip in ms. */
  ping?(host: string, timeoutMs: number): Promise<number>;
  /** Absent where the peer certificate is unavailable. */
  tls?(host: string, port: number, servername: string, timeoutMs: number): Promise<TlsProbe>;
}

export interface CheckOptions {
  transport: CheckTransport;
  /** Reported as the user agent. */
  version: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Performs one check of `monitor` (with the one quick retry) and returns its result. */
export type RunCheck = (monitor: MonitorConfig, options: CheckOptions) => Promise<CheckResult>;
