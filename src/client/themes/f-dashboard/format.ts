import type { BeatDay, DisplayState, Level, ServiceView, SiteView } from "@/shared/view";

/** Shown wherever a figure is missing (no latency, no uptime yet). */
export const NA = "n/a";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** A 0..1 ratio as `99.96%`; `100%` when whole. */
export const pct = (r: number | null | undefined, digits = 2) =>
  r === null || r === undefined ? NA : r >= 1 ? "100%" : `${(r * 100).toFixed(digits)}%`;

export const ms = (v: number | null) => (v === null ? NA : String(Math.round(v)));

/** `34 s ago`, `14 min ago`, `3 h ago`, `2 d ago`. */
export function ago(s: number | null): string {
  if (s === null) return "never";
  const n = Math.max(0, Math.round(s));
  if (n < 60) return `${n} s ago`;
  if (n < 3600) return `${Math.floor(n / 60)} min ago`;
  if (n < 86400) return `${Math.floor(n / 3600)} h ago`;
  return `${Math.floor(n / 86400)} d ago`;
}

/** A duration: `45 s`, `14 min`, `2 h 5 min`, `3 d 4 h`. */
export function dur(s: number | null): string {
  const n = Math.max(0, Math.round(s ?? 0));
  if (n < 60) return `${n} s`;
  const m = Math.floor(n / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
  const d = Math.floor(h / 24);
  return `${d} d${h % 24 ? ` ${h % 24} h` : ""}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `27 Sep, 23:57 UTC` of an ISO instant (string slicing: the same on the server and the client). */
export function when(iso: string): string {
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return "";
  const t = new Date(d).toISOString();
  return `${Number(t.slice(8, 10))} ${MONTHS[Number(t.slice(5, 7)) - 1]}, ${t.slice(11, 16)} UTC`;
}

/** `27 Sep` of a `YYYY-MM-DD` day or an ISO instant. */
export const day = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : iso;

/** Up to two initials for the logo tile: `Acme Cloud` -> `AC`. */
export function initials(name: string): string {
  const parts = (name.trim() || "?").split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** The ISO instant `seconds` before `now` (for the age tickers). */
export const isoBefore = (now: string, seconds: number) =>
  new Date(Date.parse(now) - seconds * 1000).toISOString();

export const allServices = (view: SiteView): ServiceView[] => [
  ...view.sections.flatMap((s) => s.services),
  ...view.unsectioned,
];

/** The colour family a state or level is drawn in; a state is never colour alone (pills carry a word). */
export type Tone = "up" | "degraded" | "down" | "maint" | "stale";

export function toneOf(state: DisplayState | null): Tone {
  switch (state) {
    case "up":
      return "up";
    case "degraded":
    case "pending":
      return "degraded";
    case "down":
      return "down";
    case "maintenance":
      return "maint";
    default:
      return "stale";
  }
}

export const LEVEL_TONE: Record<Level, Tone> = { ok: "up", warn: "degraded", crit: "down", info: "stale" };

/** Fill colour of a tick, a column or a legend swatch. */
export const TONE_FILL: Record<Tone, string> = {
  up: "var(--color-up)",
  degraded: "var(--color-degraded)",
  down: "var(--color-down)",
  maint: "var(--color-maint)",
  stale: "var(--color-stale)",
};

export const tickFill = (worst: DisplayState | null) =>
  worst === null ? "var(--f-empty-tick)" : TONE_FILL[toneOf(worst)];

export const STATE_LABEL: Record<DisplayState, string> = {
  up: "Operational",
  degraded: "Degraded",
  pending: "Pending",
  down: "Down",
  maintenance: "Maintenance",
  paused: "Paused",
  unknown: "Unknown",
  stale: "Stale",
};

export const stateLabel = (s: DisplayState | null) => (s === null ? "No data" : (STATE_LABEL[s] ?? s));

const SEVERITY: Record<string, number> = {
  down: 5,
  degraded: 4,
  pending: 3,
  maintenance: 2,
  up: 1,
  stale: 0,
  paused: 0,
  unknown: 0,
};

/** The worst display state of `services` (`unknown` when empty). */
export function worstState(services: ServiceView[]): DisplayState {
  let worst: DisplayState = "unknown";
  for (const s of services) if ((SEVERITY[s.state] ?? 0) >= (SEVERITY[worst] ?? 0)) worst = s.state;
  return worst;
}

export interface HistoryDay {
  day: string;
  uptime: number | null;
  worst: BeatDay["worst"];
  minutesDown: number;
}

/**
 * The site's 90 days: each day's mean uptime across services, its worst state and the service-minutes down
 * (summed). Days no service has data for keep `uptime: null`.
 */
export function siteDays(services: ServiceView[]): HistoryDay[] {
  const n = Math.max(0, ...services.map((s) => s.beats90d.length));
  return Array.from({ length: n }, (_, i) => {
    let sum = 0;
    let count = 0;
    let mins = 0;
    let worst: BeatDay["worst"] = null;
    let date = "";
    for (const s of services) {
      const b = s.beats90d[i];
      if (!b) continue;
      date ||= b.day;
      if (b.uptime !== null) {
        sum += b.uptime;
        count++;
      }
      mins += b.minutesDown;
      if (b.worst && (worst === null || (SEVERITY[b.worst] ?? 0) > (SEVERITY[worst] ?? 0))) worst = b.worst;
    }
    return { day: date, uptime: count ? sum / count : null, worst, minutesDown: mins };
  });
}

/** Summary figures of `siteDays` for the history card. */
export function historyStats(days: HistoryDay[]) {
  const known = days.filter((d) => d.uptime !== null);
  const mean = known.length ? known.reduce((a, d) => a + d.uptime!, 0) / known.length : null;
  const min = known.length ? Math.min(...known.map((d) => d.uptime!)) : 1;
  return {
    mean,
    /** The chart's lowest gridline: just under the worst day, never above 99.5%. */
    floor: Math.min(0.995, Math.floor((min - 0.0005) * 1000) / 1000),
    downDays: days.filter((d) => d.worst === "down").length,
    degradedDays: days.filter((d) => d.worst === "degraded" || d.worst === "pending").length,
    minutesDown: days.reduce((a, d) => a + d.minutesDown, 0),
  };
}

/** Line and area paths of a latency series (oldest first) in a `w` x `h` box, 4px padding top and bottom. */
export function sparkPaths(points: number[], w: number, h: number): { line: string; area: string } | null {
  if (points.length < 2) return null;
  let min = Math.min(...points);
  let max = Math.max(...points);
  if (max - min < 1) {
    max += 1;
    min -= 1;
  }
  const pad = 4;
  const line = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = pad + (1 - (v - min) / (max - min)) * (h - pad * 2);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
}
