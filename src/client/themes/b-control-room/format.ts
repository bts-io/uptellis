import type { BeatDay, DisplayState, Level, ServiceView, SiteView } from "@/shared/view";

/** Shown wherever a value is missing (a fact the collector did not send, a check without latency). */
export const DASH = "-";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** `HH:MM:SS` / `HH:MM` of an ISO timestamp (times on this page are UTC). */
export const hhmmss = (ts: string) => ts.slice(11, 19);
export const hhmm = (ts: string) => ts.slice(11, 16);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** `Jun 30` of a `YYYY-MM-DD` day or an ISO timestamp. */
export const monthDay = (ts: string) => `${MONTHS[Number(ts.slice(5, 7)) - 1]} ${Number(ts.slice(8, 10))}`;
export const monthName = (ts: string) => MONTHS[Number(ts.slice(5, 7)) - 1]!;

/** A figure (`2.5.5`, `41.2 MB`) rather than words: set large in the KPI strip. */
export const isFigure = (display: string) => /^[\d.,]+(\s\S+)?$/.test(display);

/** `41.2 MB` -> ["41.2", "MB"], so the unit can be set small; a value without a unit keeps it whole. */
export function splitUnit(display: string): [string, string | null] {
  const m = /^([\d.,]+)\s+(\S+)$/.exec(display);
  return m ? [m[1]!, m[2]!] : [display, null];
}

const staleOrEmpty = (f: string | undefined) => f === "stale" || f === "empty";

/** The page's data is stale or never reported (the strip under the header, the verdict). */
export const isStale = (view: SiteView) => staleOrEmpty(view.freshness.state);

/** Monitors and the summary age with the Kuma collector. */
export const kumaStale = (view: SiteView) => {
  const kuma = view.freshness.perSource.find((s) => s.kind === "kuma");
  return kuma ? staleOrEmpty(kuma.freshness) : isStale(view);
};

/** Infra (topology, Forgejo, runners, backup) ages with the facts probe, not with the Kuma collector. */
export const probeStale = (view: SiteView) => {
  const probe = view.freshness.perSource.find((s) => s.kind === "facts");
  return probe ? staleOrEmpty(probe.freshness) : isStale(view);
};

export const LEVEL_TEXT: Record<Level, string> = {
  ok: "text-up",
  warn: "text-degraded",
  crit: "text-down",
  info: "text-muted",
};

/** A fact's level as a state for a dot (info and unset read as up: the fact is present and not failing). */
export const levelState = (level: Level | null | undefined): DisplayState =>
  level === "crit" ? "down" : level === "warn" ? "degraded" : "up";

export const pct = (ratio: number | null, digits = 2) =>
  ratio === null ? DASH : ratio >= 1 ? "100" : (ratio * 100).toFixed(digits);

/** Health score band: the chip under the score and on every monitor tile. */
export function quality(score: number | null): { label: string; level: Level } {
  if (score === null) return { label: "n/a", level: "info" };
  return score >= 90
    ? { label: "good", level: "ok" }
    : score >= 75
      ? { label: "meh", level: "warn" }
      : { label: "poor", level: "crit" };
}

/** Latency band per check kind: HTTP is slower than TCP or ICMP by nature. */
export function latencyLevel(kind: ServiceView["kind"], ms: number | null): Level {
  if (ms === null) return "crit";
  const [warn, crit] = kind === "ping" ? [100, 300] : kind === "port" ? [300, 800] : [800, 1500];
  return ms < warn ? "ok" : ms < crit ? "warn" : "crit";
}

export function checkType(s: ServiceView): string {
  switch (s.kind) {
    case "http":
    case "keyword":
      return "HTTP";
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

export const allServices = (view: SiteView) => [
  ...view.sections.flatMap((s) => s.services),
  ...view.unsectioned,
];

/** The host part of a service target (`app-2:5432` -> `app-2`, `git.example.dev/x` -> `git.example.dev`). */
export const targetHost = (s: ServiceView) => s.targetDisplay?.split(/[:/]/)[0] ?? null;

const SEVERITY: Record<string, number> = {
  down: 4,
  degraded: 3,
  pending: 3,
  maintenance: 2,
  up: 1,
  paused: 0,
  unknown: 0,
};

/**
 * One 90-day bar for every monitor: each day's worst state across services and their mean uptime. Days no
 * service has data for stay `null` (hatched).
 */
export function combinedBeats(services: ServiceView[]): BeatDay[] {
  const first = services[0];
  if (!first) return [];
  return first.beats90d.map((d, i) => {
    const days = services.map((s) => s.beats90d[i]).filter((x): x is BeatDay => !!x && x.worst !== null);
    if (!days.length) return { day: d.day, worst: null, uptime: null, minutesDown: 0 };
    const worst = days.reduce((w, x) => ((SEVERITY[x.worst!] ?? 0) > (SEVERITY[w.worst!] ?? 0) ? x : w));
    const ups = days.map((x) => x.uptime).filter((u): u is number => u !== null);
    return {
      day: d.day,
      worst: worst.worst,
      uptime: ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null,
      minutesDown: Math.max(...days.map((x) => x.minutesDown)),
    };
  });
}

const BEAT_CHAR: Record<string, string> = {
  up: "+",
  degraded: "~",
  pending: "~",
  down: "x",
  maintenance: "=",
};

/** The `+~x=.` text form of a bar (aria-label and copy payload). */
export const beatsText = (days: BeatDay[]) =>
  days.map((d) => (d.worst && BEAT_CHAR[d.worst]) || ".").join("");

/** Compact age: `34s`, `14m 05s`, `3h 5m`, `2d 4h`. */
export function fmtAge(s: number): string {
  const n = Math.max(0, Math.floor(s));
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, "0")}s`;
  if (n < 86400) return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
  return `${Math.floor(n / 86400)}d ${Math.floor((n % 86400) / 3600)}h`;
}

/** The ISO instant `seconds` before `now`. */
export const isoBefore = (now: string, seconds: number) =>
  new Date(Date.parse(now) - seconds * 1000).toISOString();
