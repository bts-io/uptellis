/**
 * Folding for the 90-day history read (`D1Store.loadHistory`): per service and UTC day, beat counts from
 * the `heartbeat_5m` rollup and from raw `heartbeats` not folded yet become the view-model's `DayCell`s.
 * Pure, so it is unit tested without D1.
 */
import type { ServiceStatus } from "@/shared/model";
import type { DayCell, ServiceDays } from "@/shared/view/input";

export const DAY_MS = 86_400_000;
/** The rollup's window width (src/worker/cron.ts `BUCKET_MS`). */
export const ROLLUP_BUCKET_MS = 5 * 60_000;
export const HISTORY_DAYS = 90;

/** Beat counts of one service over some span (a 5-minute window, or a day of them). */
export interface BeatCounts {
  serviceId: string;
  /** UTC day index (epoch ms / 86 400 000). */
  dayIdx: number;
  total: number;
  up: number;
  down: number;
  maint: number;
  pending: number;
  /** Sum over windows of `5 min * down / total`. */
  minutesDown: number;
}

/**
 * The worst state of a day from its counts. The rollup keeps up, down, maintenance and pending; every
 * other status (degraded, paused, unknown) lands in the remainder, which reads as `degraded`.
 */
export function worstOf(c: Omit<BeatCounts, "serviceId" | "dayIdx" | "minutesDown">): ServiceStatus {
  const other = c.total - c.up - c.down - c.maint - c.pending;
  if (c.down > 0) return "down";
  if (other > 0) return "degraded";
  if (c.pending > 0) return "pending";
  if (c.maint > 0) return "maintenance";
  return c.up > 0 ? "up" : "unknown";
}

/**
 * Folds day (or window) counts into `ServiceDays`, services in id order, days oldest first. Uptime is the
 * share of counted beats that were not down, maintenance excluded (1 for a day of only maintenance), so
 * it agrees with `minutesDown`.
 */
export function foldHistory(rows: readonly BeatCounts[]): ServiceDays[] {
  const acc = new Map<string, Map<number, BeatCounts>>();
  for (const r of rows) {
    const days = acc.get(r.serviceId) ?? new Map<number, BeatCounts>();
    const d = days.get(r.dayIdx);
    if (d) {
      d.total += r.total;
      d.up += r.up;
      d.down += r.down;
      d.maint += r.maint;
      d.pending += r.pending;
      d.minutesDown += r.minutesDown;
    } else days.set(r.dayIdx, { ...r });
    acc.set(r.serviceId, days);
  }
  return [...acc.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([serviceId, days]) => ({
      serviceId,
      days: [...days.values()]
        .sort((a, b) => a.dayIdx - b.dayIdx)
        .map((d): DayCell => {
          const counted = d.total - d.maint;
          return {
            day: new Date(d.dayIdx * DAY_MS).toISOString().slice(0, 10),
            worst: worstOf(d),
            uptime: counted > 0 ? Math.round((1 - d.down / counted) * 1e6) / 1e6 : 1,
            minutesDown: Math.min(1440, Math.round(d.minutesDown)),
          };
        }),
    }));
}

const num = (v: unknown) => Number(v ?? 0);

/** A counts row as the history queries select it (snake_case columns). */
export const countsFromRow = (r: Record<string, unknown>): BeatCounts => ({
  serviceId: String(r.service_id),
  dayIdx: num(r.day_idx),
  total: num(r.total),
  up: num(r.up),
  down: num(r.down),
  maint: num(r.maint),
  pending: num(r.pending),
  minutesDown: num(r.minutes_down),
});
