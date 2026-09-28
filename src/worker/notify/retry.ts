/**
 * In-request retries of one delivery: a retryable outcome (429, 5xx, network, timeout) is tried again,
 * at most `MAX_ATTEMPTS` times in all, after the service's `retryAfterS` when it gives one and otherwise
 * after a short backoff (1 s, then 4 s). A `retryAfterS` longer than `MAX_RETRY_AFTER_S` is not waited
 * for: the delivery is left `failed` and retryable for the five-minute job. This runs under the
 * platform's `waitUntil`, so the waits never hold a response.
 */
import type { DeliveryOutcome } from "@/shared/notify";

export const MAX_ATTEMPTS = 3;
/** A longer wait than this is left to the five-minute job: the cron and the ingest have work to finish. */
export const MAX_RETRY_AFTER_S = 30;
/** The wait before the second and the third attempt when the service names none. */
export const BACKOFF_MS = [1000, 4000] as const;

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryResult {
  outcome: DeliveryOutcome;
  attempts: number;
}

export async function sendWithRetries(
  send: () => Promise<DeliveryOutcome>,
  opts: { sleep?: Sleep; maxAttempts?: number } = {},
): Promise<RetryResult> {
  const sleep = opts.sleep ?? realSleep;
  const max = opts.maxAttempts ?? MAX_ATTEMPTS;
  let attempts = 0;
  for (;;) {
    const outcome = await send();
    attempts++;
    if (outcome.ok || !outcome.retryable || attempts >= max) return { outcome, attempts };
    const after = outcome.retryAfterS;
    if (after !== undefined && after > MAX_RETRY_AFTER_S) return { outcome, attempts };
    await sleep(
      after !== undefined ? Math.ceil(after * 1000) : BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1]!,
    );
  }
}
