// The agent API (src/shared/monitors/api.ts): the monitors this agent runs, and results in batches.
// Returns statuses and parsed bodies only; response bodies are never logged.
import {
  AGENT_API_PREFIX,
  AgentMonitorsResponse,
  type CheckResult,
  ResultsAccepted,
  type ResultsBatch,
  RUNNER_HEADER,
} from "./shared";
import { AGENT_NAME } from "./version";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  runner: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export type MonitorsFetch =
  | { kind: "changed"; body: AgentMonitorsResponse; etag: string | null }
  | { kind: "unchanged" }
  /** Status 0: no answer (network error or timeout); `invalid`: a 200 whose body is not the contract. */
  | { kind: "failed"; status: number; retryAfterMs: number | null; invalid?: boolean };

export type ResultsPost =
  | { kind: "accepted"; status: number; accepted: ResultsAccepted | null }
  | { kind: "failed"; status: number; retryAfterMs: number | null };

/** `Retry-After` in seconds or as an HTTP date, in ms from now; null when absent or unreadable. */
export function retryAfterMs(res: Response, now = Date.now()): number | null {
  const v = res.headers.get("retry-after");
  if (!v) return null;
  if (/^\d+$/.test(v.trim())) return Number(v.trim()) * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

export class AgentClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly o: ClientOptions) {
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 20_000;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${this.o.apiKey}`,
      [RUNNER_HEADER]: this.o.runner,
      "user-agent": AGENT_NAME,
      accept: "application/json",
      ...extra,
    };
  }

  async fetchMonitors(etag: string | null): Promise<MonitorsFetch> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.o.baseUrl}${AGENT_API_PREFIX}/monitors`, {
        method: "GET",
        headers: this.headers(etag ? { "if-none-match": etag } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { kind: "failed", status: 0, retryAfterMs: null };
    }
    if (res.status === 304) {
      await res.body?.cancel().catch(() => undefined);
      return { kind: "unchanged" };
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return { kind: "failed", status: res.status, retryAfterMs: retryAfterMs(res) };
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { kind: "failed", status: res.status, retryAfterMs: null, invalid: true };
    }
    const parsed = AgentMonitorsResponse.safeParse(json);
    if (!parsed.success) return { kind: "failed", status: res.status, retryAfterMs: null, invalid: true };
    return { kind: "changed", body: parsed.data, etag: res.headers.get("etag") };
  }

  /** The request body for `results` (also used to measure a batch against the byte cap). */
  static body(results: readonly CheckResult[], sentAt: Date): string {
    const batch: ResultsBatch = {
      v: 1,
      agent: AGENT_NAME,
      sentAt: sentAt.toISOString(),
      results: [...results],
    };
    return JSON.stringify(batch);
  }

  async postResults(body: string): Promise<ResultsPost> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.o.baseUrl}${AGENT_API_PREFIX}/results`, {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { kind: "failed", status: 0, retryAfterMs: null };
    }
    if (res.status >= 200 && res.status < 300) {
      let accepted: ResultsAccepted | null = null;
      try {
        const parsed = ResultsAccepted.safeParse(await res.json());
        if (parsed.success) accepted = parsed.data;
      } catch {
        // The counts are for the log only; a 2xx is the acknowledgement.
      }
      return { kind: "accepted", status: res.status, accepted };
    }
    await res.body?.cancel().catch(() => undefined);
    return { kind: "failed", status: res.status, retryAfterMs: retryAfterMs(res) };
  }
}
