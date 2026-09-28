import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryOutcome } from "@/shared/notify";
import { BACKOFF_MS, MAX_ATTEMPTS, MAX_RETRY_AFTER_S, sendWithRetries } from "@/worker/notify/retry";

const fail = (extra: Partial<Extract<DeliveryOutcome, { ok: false }>> = {}): DeliveryOutcome => ({
  ok: false,
  status: 503,
  error: "http_503",
  retryable: true,
  ...extra,
});

/** A send answering `outcomes` in order, recording when each attempt ran. */
function sender(...outcomes: DeliveryOutcome[]) {
  const at: number[] = [];
  const send = vi.fn(async () => {
    at.push(Date.now());
    return outcomes.shift() ?? { ok: true as const, status: 200 };
  });
  return { send, at };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-09-27T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("in-request retries", () => {
  it("backs off 1 s then 4 s and stops after three attempts", async () => {
    const { send, at } = sender(fail(), fail(), fail());
    const run = sendWithRetries(send);
    await vi.runAllTimersAsync();
    expect(await run).toEqual({ outcome: fail(), attempts: MAX_ATTEMPTS });
    expect(at.map((t) => t - at[0]!)).toEqual([0, BACKOFF_MS[0], BACKOFF_MS[0] + BACKOFF_MS[1]]);
  });

  it("returns on the first success", async () => {
    const { send } = sender(fail({ status: 0, error: "network" }));
    const run = sendWithRetries(send);
    await vi.runAllTimersAsync();
    expect(await run).toEqual({ outcome: { ok: true, status: 200 }, attempts: 2 });
  });

  it("waits the service's retryAfterS instead of the backoff", async () => {
    const { send, at } = sender(fail({ status: 429, error: "rate_limited", retryAfterS: 2.5 }));
    const run = sendWithRetries(send);
    await vi.runAllTimersAsync();
    expect((await run).attempts).toBe(2);
    expect(at[1]! - at[0]!).toBe(2500);
  });

  it("leaves a long rate limit to the five-minute job", async () => {
    const limited = fail({ status: 429, error: "rate_limited", retryAfterS: MAX_RETRY_AFTER_S + 1 });
    const { send } = sender(limited);
    const run = sendWithRetries(send);
    await vi.runAllTimersAsync();
    expect(await run).toEqual({ outcome: limited, attempts: 1 });
  });

  it("never retries a final failure", async () => {
    const final = fail({ status: 404, error: "http_404", retryable: false });
    const { send } = sender(final);
    expect(await sendWithRetries(send)).toEqual({ outcome: final, attempts: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
