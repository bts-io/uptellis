/**
 * In-memory fixed-window limiters for Docker, one per `RATE_LIMITERS` entry: a key may make `limit`
 * requests per window of `periodS` seconds, windows aligned to the epoch (like Cloudflare's). One process
 * holds all counters, so the limits are exact; a restart clears them.
 */
import { RATE_LIMITERS, type RateLimiter, type RateLimiterName } from "../types";

export function fixedWindowLimiter(limit: number, periodS: number, now: () => number): RateLimiter {
  const periodMs = periodS * 1000;
  let window = -1;
  const counts = new Map<string, number>();
  return {
    async limit(key) {
      const current = Math.floor(now() / periodMs);
      if (current !== window) {
        // A new window: every earlier count is void, so the map never outgrows one window's keys.
        window = current;
        counts.clear();
      }
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n <= limit;
    },
  };
}

/** One limiter per name, with the budgets of `RATE_LIMITERS`. */
export function memoryLimiters(now: () => number): Record<RateLimiterName, RateLimiter> {
  const entries = Object.entries(RATE_LIMITERS).map(([name, { limit, periodS }]) => [
    name,
    fixedWindowLimiter(limit, periodS, now),
  ]);
  return Object.fromEntries(entries) as Record<RateLimiterName, RateLimiter>;
}
