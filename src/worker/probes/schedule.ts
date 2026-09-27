/** When a probe is due and how many run at once (pure, no Worker bindings). */
import type { ProbeConfig } from "@/shared/config";

const MINUTE_MS = 60_000;

/** A probe runs on the minutes that are a multiple of its interval (every minute at 60 s). */
export const isDue = (probe: ProbeConfig, scheduledMs: number) =>
  Math.floor(scheduledMs / MINUTE_MS) % (probe.intervalS / 60) === 0;

/** Maps `items` through `fn` with at most `limit` calls in flight, keeping the input order. */
export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
