import type { BeatDay, DisplayState, SiteView } from "@/shared/view";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const date = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);

/** `Sep 27` of an ISO instant or a `YYYY-MM-DD` day (UTC). */
export function shortDay(iso: string): string {
  const t = date(iso);
  return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`;
}

/** `23:57 UTC`. */
export function hhmm(iso: string): string {
  const t = date(iso);
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} UTC`;
}

/** `Sep 27, 23:57 UTC`. */
export const dayTime = (iso: string) => `${shortDay(iso)}, ${hhmm(iso)}`;

/** A compact duration: `34s`, `14 min`, `2h 5m`, `3d 4h`. */
export function dur(s: number): string {
  if (s < 60) return `${Math.max(1, Math.round(s))}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h}h${rm ? ` ${rm}m` : ""}`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** An age as `34s ago`: always the real age, never "just now". */
export const ago = (s: number) => `${dur(s)} ago`;

/** A 0..1 ratio as `99.96%` (`100%` from 99.995 up). */
export const pct = (r: number) => `${r >= 0.99995 ? "100" : (r * 100).toFixed(2)}%`;

export const WORD: Record<DisplayState, string> = {
  up: "Operational",
  degraded: "Degraded",
  down: "Down",
  pending: "Pending",
  maintenance: "Maintenance",
  paused: "Paused",
  unknown: "Unknown",
  stale: "No recent data",
};

/** A strip cell's tooltip: `Sep 15: Down, 97.08%`. */
export function cellTitle(b: BeatDay): string {
  const head = `${shortDay(b.day)}: `;
  if (b.worst === null) return `${head}no data`;
  return `${head}${WORD[b.worst]}${b.uptime !== null ? `, ${pct(b.uptime)}` : ""}`;
}

/** Mean uptime over the days that have data, null when none has. */
export function meanUptime(days: BeatDay[]): number | null {
  const ups = days.map((d) => d.uptime).filter((u): u is number => u !== null);
  return ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
}

export const allServices = (view: SiteView) => [
  ...view.sections.flatMap((s) => s.services),
  ...view.unsectioned,
];

/** The ISO instant `seconds` before `now`. */
export const isoBefore = (now: string, seconds: number) =>
  new Date(Date.parse(now) - seconds * 1000).toISOString();
