import type { DisplayState, Level, ServiceView, SiteView } from "@/shared/view";

/** Shown wherever a value is missing (a fact the probe did not send, a check without latency). */
export const DASH = "-";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** `HH:MM:SS` and `HH:MM` of an ISO timestamp (times on this page are UTC). */
export const hhmmss = (ts: string) => ts.slice(11, 19);
export const hhmm = (ts: string) => ts.slice(11, 16);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** `Sep 27` of an ISO date or timestamp. */
export const monthDay = (ts: string) => `${MONTHS[Number(ts.slice(5, 7)) - 1]} ${ts.slice(8, 10)}`;

/** The ISO instant `seconds` before `now`. */
export const isoBefore = (now: string, seconds: number) =>
  new Date(Date.parse(now) - seconds * 1000).toISOString();

/** Every service on the page, sections first. */
export const allServices = (view: SiteView): ServiceView[] => [
  ...view.sections.flatMap((s) => s.services),
  ...view.unsectioned,
];

/** The Kuma collector is stale or never reported: monitor dots go hollow and values read as history. */
export const isStale = (view: SiteView) =>
  view.freshness.state === "stale" || view.freshness.state === "empty";

/** The facts probe is stale or never reported (topology ages with it, not with the Kuma collector). */
export const probeStale = (view: SiteView) => {
  const probe = view.freshness.perSource.find((s) => s.kind === "facts");
  return probe ? probe.freshness === "stale" || probe.freshness === "empty" : isStale(view);
};

/** A service that needs attention (maintenance is planned; stale is shown as history, not as a failure). */
export const failing = (s: ServiceView) => !["up", "maintenance", "stale"].includes(s.state);

export const LEVEL_TEXT: Record<Level, string> = {
  ok: "text-up",
  warn: "text-degraded",
  crit: "text-down",
  info: "text-muted",
};

export const STATE_TEXT: Record<DisplayState, string> = {
  up: "text-up",
  degraded: "text-degraded",
  pending: "text-degraded",
  down: "text-down",
  maintenance: "text-maint",
  paused: "text-muted",
  unknown: "text-muted",
  stale: "text-muted",
};

/** A level as the state its dot shows. */
export const levelState = (level: Level | null | undefined): DisplayState =>
  level === "crit" ? "down" : level === "warn" ? "degraded" : level === "ok" ? "up" : "unknown";

/** A 0..1 ratio as a percentage number without the sign: `100`, `99.97`. */
export const pct = (ratio: number | null) =>
  ratio === null ? DASH : ratio >= 1 ? "100" : (ratio * 100).toFixed(2);

export const healthLevel = (score: number): Level => (score >= 90 ? "ok" : score >= 75 ? "warn" : "crit");

/** Compact duration: `34s`, `14m 29s`, `3h 05m`, `2d 4h`. */
export function dur(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds));
  const pad = (x: number) => String(x).padStart(2, "0");
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${pad(n % 60)}s`;
  if (n < 86400) return `${Math.floor(n / 3600)}h ${pad(Math.floor((n % 3600) / 60))}m`;
  return `${Math.floor(n / 86400)}d ${Math.floor((n % 86400) / 3600)}h`;
}

export function checkType(s: ServiceView): string {
  switch (s.kind) {
    case "http":
    case "keyword":
      return s.method ? `HTTP ${s.method}` : "HTTP";
    case "port":
      return "TCP";
    case "ping":
      return "ICMP";
    case "push":
      return "PUSH";
    case "fact":
      return "FACT";
  }
}

/** `api-health`: the argument of the inspect block's command tag. */
export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** `41.2 MB` -> ["41.2", "MB"], so the unit can be set small; a value without a unit keeps it whole. */
export function splitUnit(display: string): [string, string | null] {
  const m = /^([\d.,]+)\s+(\S+)$/.exec(display);
  return m ? [m[1]!, m[2]!] : [display, null];
}

/** Status changes and incidents of the last day, then the newest checks, for the activity tail. */
export function activityRows(view: SiteView, rows: number) {
  const since = Date.parse(view.now) - 24 * 3600_000;
  const events = view.activity.filter((a) => Date.parse(a.ts) >= since).slice(0, rows / 2);
  const checks = allServices(view)
    .flatMap((s) => s.recent.map((beat) => ({ id: s.id, service: s.name, beat })))
    .sort((a, b) => b.beat.ts.localeCompare(a.beat.ts))
    .slice(0, rows);
  return { events, checks };
}
