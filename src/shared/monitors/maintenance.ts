/**
 * Maintenance windows at a moment (pure; the clock comes in as `nowMs`). A service inside an active window
 * shows `maintenance`, opens no incident and sends no card (see ./confirm.ts and src/worker/notify).
 *
 * - `once`: active from `start` (inclusive) to `end` (exclusive).
 * - `weekly`: starts at the local time `start` in `timeZone` on each listed day and lasts `durationMin`
 *   real minutes, so a window may run past midnight into the next day. Local times follow the zone's
 *   rules through `Intl.DateTimeFormat`: a start inside a spring-forward gap moves forward by the gap
 *   (02:30 on the Paris switch day starts at 03:30), and a start that occurs twice on a fall-back day
 *   uses the first occurrence (as Temporal's `compatible`). An unknown zone never matches.
 *
 * `services` empty means every service of the site.
 */
import type { MaintenanceWindow } from "./schema";
import { WEEKDAYS } from "./schema";

export interface MaintenanceConfig {
  readonly maintenance: readonly MaintenanceWindow[];
}

/** A window that is active now, with the bounds of its current occurrence (epoch ms). */
export interface ActiveWindow {
  window: MaintenanceWindow;
  start: number;
  end: number;
}

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;

/** Every window active at `nowMs`, in config order. */
export function activeWindows(config: MaintenanceConfig, nowMs: number): ActiveWindow[] {
  const out: ActiveWindow[] = [];
  for (const window of config.maintenance) {
    const span = currentSpan(window, nowMs);
    if (span) out.push({ window, ...span });
  }
  return out;
}

/** Whether `serviceId` is inside any window active at `nowMs`. */
export function inMaintenance(config: MaintenanceConfig, serviceId: string, nowMs: number): boolean {
  return activeWindows(config, nowMs).some(
    ({ window }) => window.services.length === 0 || window.services.includes(serviceId),
  );
}

function currentSpan(w: MaintenanceWindow, nowMs: number): { start: number; end: number } | null {
  if (w.kind === "once") {
    const start = Date.parse(w.start);
    const end = Date.parse(w.end);
    return start <= nowMs && nowMs < end ? { start, end } : null;
  }
  const fmt = formatter(w.timeZone);
  if (!fmt) return null;
  const [hh, mm] = w.start.split(":").map(Number) as [number, number];
  const today = localParts(fmt, nowMs);
  // A window lasts at most 24 h, so only occurrences that started today or on the two days before
  // (local dates) can still be running.
  for (let back = 0; back <= 2; back++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day - back));
    const weekday = WEEKDAYS[(day.getUTCDay() + 6) % 7]!;
    if (!w.days.includes(weekday)) continue;
    const start = localToUtc(
      fmt,
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm),
    );
    const end = start + w.durationMin * MIN_MS;
    if (start <= nowMs && nowMs < end) return { start, end };
  }
  return null;
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();

/** A cached formatter for the zone, or null when the runtime does not know it. */
function formatter(timeZone: string): Intl.DateTimeFormat | null {
  let f = formatters.get(timeZone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      f = null;
    }
    formatters.set(timeZone, f);
  }
  return f;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(fmt: Intl.DateTimeFormat, t: number): LocalParts {
  const p: Record<string, number> = {};
  for (const { type, value } of fmt.formatToParts(t)) {
    if (type !== "literal") p[type] = Number(value);
  }
  return {
    year: p.year!,
    month: p.month!,
    day: p.day!,
    hour: p.hour! % 24,
    minute: p.minute!,
    second: p.second!,
  };
}

/** The zone's offset from UTC at instant `t` (ms, positive east of Greenwich). */
function offsetAt(fmt: Intl.DateTimeFormat, t: number): number {
  const p = localParts(fmt, t);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(t / 1000) * 1000;
}

/**
 * The instant a local wall time (given as if it were UTC) happens in the zone: the earlier one when it
 * happens twice, and shifted forward by the gap when it never happens.
 */
function localToUtc(fmt: Intl.DateTimeFormat, wall: number): number {
  const before = offsetAt(fmt, wall - DAY_MS);
  const after = offsetAt(fmt, wall + DAY_MS);
  const valid = [...new Set([before, after])]
    .map((o) => wall - o)
    .filter((t) => offsetAt(fmt, t) === wall - t)
    .sort((a, b) => a - b);
  return valid[0] ?? wall - before;
}
