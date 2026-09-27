import { useEffect, useState } from "react";
import { useVisibilityPause } from "./visibility";

/** Whole seconds from `since` to `now` (ISO strings), never negative; 0 when either does not parse. */
export function secondsBetween(since: string, now: string): number {
  const s = Math.floor((Date.parse(now) - Date.parse(since)) / 1000);
  return Number.isFinite(s) ? Math.max(0, s) : 0;
}

/**
 * Seconds elapsed since `since`, counted from the server's `now` and advanced by the time this component has
 * been mounted. The server and the first client render agree (no hydration mismatch) and a skewed client
 * clock does not matter. Ticks every `everyMs` while the tab is visible and catches up when it returns.
 */
export function useAgeTicker(since: string, now: string, everyMs = 1000): number {
  const base = secondsBetween(since, now);
  const key = `${since}|${now}`;
  const visible = useVisibilityPause();
  const [tick, setTick] = useState<{ key: string; mountedAt: number | null; elapsed: number }>({
    key,
    mountedAt: null,
    elapsed: 0,
  });

  useEffect(() => {
    if (!visible) return;
    const mountedAt = tick.key === key && tick.mountedAt !== null ? tick.mountedAt : Date.now();
    const update = () => setTick({ key, mountedAt, elapsed: Math.floor((Date.now() - mountedAt) / 1000) });
    update();
    const id = setInterval(update, everyMs);
    return () => clearInterval(id);
  }, [key, everyMs, visible]);

  return base + (tick.key === key ? tick.elapsed : 0);
}
