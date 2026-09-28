// When to try again after a failed request. Two ladders:
// - transient (network error, timeout, 429, 5xx): 5 s doubling to 5 min, jittered (0.75x to 1.25x, never
//   above the cap), and at least what a `Retry-After` asks (itself capped at 15 min);
// - auth (401, 403): 5 min doubling to 30 min. The key or the site config needs a human; the agent keeps
//   buffering and asks again now and then instead of hammering.
export const TRANSIENT_BASE_MS = 5_000;
export const TRANSIENT_CAP_MS = 5 * 60_000;
export const AUTH_BASE_MS = 5 * 60_000;
export const AUTH_CAP_MS = 30 * 60_000;
const RETRY_AFTER_CAP_MS = 15 * 60_000;

export type FailureKind = "transient" | "auth";

export class Backoff {
  failures = 0;
  /** Epoch ms before which no request is made. */
  until = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  /** Records a failure; returns the delay chosen. */
  fail(kind: FailureKind, retryAfterMs: number | null = null): number {
    this.failures++;
    const [base, cap] = kind === "auth" ? [AUTH_BASE_MS, AUTH_CAP_MS] : [TRANSIENT_BASE_MS, TRANSIENT_CAP_MS];
    const raw = Math.min(cap, base * 2 ** Math.min(this.failures - 1, 20));
    let delay = Math.min(cap, Math.round(raw * (0.75 + this.random() * 0.5)));
    if (retryAfterMs !== null) delay = Math.max(delay, Math.min(retryAfterMs, RETRY_AFTER_CAP_MS));
    this.until = this.now() + delay;
    return delay;
  }

  reset(): void {
    this.failures = 0;
    this.until = 0;
  }

  /** Ms left before the next attempt (0 when one may go now). */
  remaining(): number {
    return Math.max(0, this.until - this.now());
  }
}

/** How a failed status is retried (the flusher handles 400 and 413 itself before asking). */
export function failureKind(status: number): FailureKind {
  return status === 401 || status === 403 ? "auth" : "transient";
}
