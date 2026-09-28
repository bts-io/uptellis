/** When a monitor is due and how many checks run at once (pure, no Worker bindings). */
import type { MonitorConfig } from "@/shared/monitors";

const MINUTE_MS = 60_000;

/** A monitor runs on the minutes that are a multiple of its interval (every minute at 60 s). */
export const isDue = (monitor: Pick<MonitorConfig, "intervalS">, scheduledMs: number) =>
  Math.floor(scheduledMs / MINUTE_MS) % (monitor.intervalS / 60) === 0;

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
