import type { BeatDay, DisplayState, ServiceView, SiteView } from "@/shared/view";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** `Sep 27, 2026` of an ISO instant or a `YYYY-MM-DD` day (UTC). */
export function fmtDay(iso: string): string {
  const t = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`;
}

/** `23:57 UTC`. */
export function fmtTime(iso: string): string {
  const t = new Date(iso);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} UTC`;
}

/** `Sep 27, 23:57 UTC`. */
export function fmtDayTime(iso: string): string {
  const t = new Date(iso);
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${fmtTime(iso)}`;
}

/** A duration in words: `34 sec`, `14 min`, `2 h 5 min`, `3 d 4 h`. */
export function fmtDur(s: number): string {
  if (s < 60) return `${Math.max(1, Math.round(s))} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h} h${rm ? ` ${rm} min` : ""}`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d} d${rh ? ` ${rh} h` : ""}`;
}

/** An age as `34 sec ago`: always the real age, never "just now" (the mock-up hid a 34 s old snapshot). */
export const fmtAgo = (s: number) => `${fmtDur(s)} ago`;

/** A 0..1 ratio as `99.96%` (`100%` from 99.995 up), null for none. */
export function fmtPct(r: number | null): string | null {
  if (r === null) return null;
  const p = r * 100;
  return `${p >= 99.995 ? "100" : p.toFixed(2)}%`;
}

export const STATE_LABEL: Record<DisplayState, string> = {
  up: "Operational",
  degraded: "Degraded",
  down: "Down",
  pending: "Pending",
  maintenance: "Maintenance",
  paused: "Paused",
  unknown: "Unknown",
  stale: "No recent data",
};

/** Mean uptime over the days that have data, null when none has. */
export function uptime90(days: BeatDay[]): number | null {
  const ups = days.map((d) => d.uptime).filter((u): u is number => u !== null);
  return ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
}

/** The tooltip of one day's tick: `Sep 15, 2026, Down, 97.08% uptime, 42 min down`. */
export function tickTitle(b: BeatDay): string {
  const parts = [fmtDay(b.day)];
  if (b.worst === null) parts.push("No data");
  else {
    parts.push(STATE_LABEL[b.worst]);
    if (b.uptime !== null) parts.push(`${fmtPct(b.uptime)} uptime`);
    if (b.minutesDown) parts.push(`${b.minutesDown} min down`);
  }
  return parts.join(", ");
}

const ORDER: DisplayState[] = [
  "down",
  "degraded",
  "stale",
  "pending",
  "unknown",
  "paused",
  "maintenance",
  "up",
];

/** The worst state among services (`unknown` for none), for the "Other services" group. */
export function worstState(services: ServiceView[]): DisplayState {
  let best: DisplayState = "unknown";
  let rank = ORDER.length;
  for (const s of services) {
    const r = ORDER.indexOf(s.state);
    if (r >= 0 && r < rank) {
      rank = r;
      best = s.state;
    }
  }
  return best;
}

export const allServices = (view: SiteView) => [
  ...view.sections.flatMap((s) => s.services),
  ...view.unsectioned,
];

/** Service id -> display name, for maintenance scopes. */
export const serviceNames = (view: SiteView) => new Map(allServices(view).map((s) => [s.id, s.name]));

/** The ISO instant `seconds` before `now`. */
export const isoBefore = (now: string, seconds: number) =>
  new Date(Date.parse(now) - seconds * 1000).toISOString();

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
