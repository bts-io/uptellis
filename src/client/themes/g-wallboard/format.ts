import type { DisplayState, FactGroupView, Level, ServiceView, SiteView } from "@/shared/view";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Milliseconds each page of sections stays on screen before the board turns to the next. */
export const PAGE_MS = 10_000;

/** The one word a tile shows for its state, big and uppercase. */
export const WORD: Record<DisplayState, string> = {
  up: "Up",
  down: "Down",
  degraded: "Slow",
  pending: "Pending",
  maintenance: "Maint",
  stale: "Stale",
  paused: "Paused",
  unknown: "Unknown",
};

/** How bad a state is, for the section a page starts on (the worst one). */
export const RANK: Record<DisplayState, number> = {
  down: 5,
  degraded: 4,
  pending: 4,
  stale: 3,
  maintenance: 2,
  unknown: 1,
  paused: 1,
  up: 0,
};

/** The worst state in a list (`up` for an empty one). */
export const worstOf = (states: DisplayState[]): DisplayState =>
  states.reduce<DisplayState>((w, s) => (RANK[s] > RANK[w] ? s : w), "up");

/** Age in the board's words: `34 s`, `6 min`, `3 h`, `4 days`; `never` without one. */
export function ago(s: number | null): string {
  if (s === null) return "never";
  const n = Math.max(0, Math.floor(s));
  if (n < 60) return `${n} s`;
  if (n < 3600) return `${Math.round(n / 60)} min`;
  if (n < 172800) return `${Math.round(n / 3600)} h`;
  return `${Math.round(n / 86400)} days`;
}

/** `HH:MM UTC` of an ISO instant. */
export const clock = (iso: string) => `${iso.slice(11, 16)} UTC`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `16 Sep` of an ISO instant. */
export const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/** `HH:MM UTC`, with the date in front when it is not today (a window that ends tomorrow). */
export const until = (iso: string, now: string) =>
  iso.slice(0, 10) === now.slice(0, 10) ? clock(iso) : `${iso.slice(0, 10)} ${clock(iso)}`;

/** A 0..1 ratio as `99.85%`, rounded down so a blip never reads as 100. */
export const pct = (r: number | null) => (r === null ? null : `${(Math.floor(r * 10000) / 100).toFixed(2)}%`);

export const ms = (v: number | null) => (v === null ? null : `${Math.round(v)} ms`);

/** The ISO instant `seconds` before `now`. */
export const isoBefore = (now: string, seconds: number) =>
  new Date(Date.parse(now) - seconds * 1000).toISOString();

export const allServices = (view: SiteView) => [
  ...view.sections.flatMap((s) => s.services),
  ...view.unsectioned,
];

/** The site's data is fresh enough to vouch for (or quiet only because maintenance covers everything). */
export const isFresh = (view: SiteView) =>
  view.freshness.state === "fresh" ||
  view.freshness.state === "aging" ||
  !!view.freshness.quietForMaintenance;

/** Infra facts age with the facts probe, not with the monitors' collector. */
export function factsStale(view: SiteView): boolean {
  const probe = view.freshness.perSource.find((s) => s.kind === "facts");
  const f = probe ? probe.freshness : view.freshness.state;
  return f === "stale" || f === "empty";
}

/** A fact group's level as a board state (`stale` once its facts are old). */
export function groupState(group: FactGroupView, stale: boolean): DisplayState {
  if (stale || !group.fresh) return "stale";
  return LEVEL_STATE[group.level];
}

const LEVEL_STATE: Record<Level, DisplayState> = {
  ok: "up",
  info: "up",
  warn: "degraded",
  crit: "down",
};

/** A group of tiles on the board: a config section, the unsectioned services, or the infra facts. */
export type BoardGroup =
  | { kind: "services"; id: string; title: string; state: DisplayState; services: ServiceView[] }
  | { kind: "facts"; id: string; title: string; state: DisplayState; groups: FactGroupView[] };

/**
 * The board's groups in page order: config sections, then "Other" for unsectioned services, then one
 * "Infrastructure" group of the fact groups the footer's highlights do not already show.
 */
export function boardGroups(view: SiteView): BoardGroup[] {
  const out: BoardGroup[] = view.sections.map((s) => ({
    kind: "services",
    id: s.id,
    title: s.title,
    state: s.state,
    services: s.services,
  }));
  if (view.unsectioned.length)
    out.push({
      kind: "services",
      id: "_other",
      title: "Other",
      state: worstOf(view.unsectioned.map((s) => s.state)),
      services: view.unsectioned,
    });
  const highlighted = new Set(view.highlights.map((h) => h.row.group));
  const facts = view.factGroups.filter((g) => !highlighted.has(g.id));
  if (facts.length) {
    const stale = factsStale(view);
    out.push({
      kind: "facts",
      id: "_infra",
      title: "Infrastructure",
      state: worstOf(facts.map((g) => groupState(g, stale))),
      groups: facts,
    });
  }
  return out;
}

/** Tiles in a group (the width it spans on the four-column board, at most four). */
export const groupSize = (g: BoardGroup) =>
  Math.min(4, Math.max(1, g.kind === "services" ? g.services.length : g.groups.length));

/** The page holding the worst group (the first page for a tie), where the rotation starts. */
export function startPage(pages: number[][], ranks: number[]): number {
  let best = -1;
  let at = 0;
  pages.forEach((p, i) => {
    for (const g of p) {
      const r = ranks[g] ?? 0;
      if (r > best) {
        best = r;
        at = i;
      }
    }
  });
  return at;
}

/**
 * Splits groups into pages: `fits(set)` says whether a set of groups fits the screen. Groups keep their
 * order; a group too big for a page on its own still gets one.
 */
export function paginate(count: number, fits: (set: number[]) => boolean): number[][] {
  const all = Array.from({ length: count }, (_, i) => i);
  if (fits(all)) return [all];
  const pages: number[][] = [];
  let cur: number[] = [];
  for (const i of all) {
    cur.push(i);
    if (cur.length > 1 && !fits(cur)) {
      cur.pop();
      pages.push(cur);
      cur = [i];
    }
  }
  if (cur.length) pages.push(cur);
  return pages;
}

/** The sources behind stale data (stale or never reported), by id. */
export const silentSources = (view: SiteView) =>
  view.freshness.perSource.filter((p) => p.freshness === "stale" || p.freshness === "empty").map((p) => p.id);

/** Alert strips a wall screen shows in full; past this many it shows the first ones and a "+M more" row. */
export const WALL_ALERTS = 2;

/**
 * How the alert strips sit on a wall screen (from 900 px; a phone shows every strip and scrolls). Open
 * incidents come first, then the stale notice, then maintenance windows. While incidents are open the stale
 * notice folds into the header's age line, so it takes no row. When more than `WALL_ALERTS` strips remain,
 * the first `WALL_ALERTS` show and one compact row counts the rest. `rows` is the rows the wall shows.
 */
export interface AlertPlan {
  /** The stale notice folds into the header (stale data while incidents are open). */
  staleInHeader: boolean;
  /** Strips shown in full on the wall, in order (incidents, stale unless folded, maintenance). */
  shown: number;
  /** Strips counted in the "+M more" row instead. */
  more: number;
  rows: number;
}

export function alertPlan(view: SiteView): AlertPlan {
  const incidents = view.incidents.open.length;
  const stale = !isFresh(view);
  const staleInHeader = stale && incidents > 0;
  const total = incidents + (stale && !staleInHeader ? 1 : 0) + (view.maintenance?.length ?? 0);
  const shown = total > WALL_ALERTS ? WALL_ALERTS : total;
  const more = total - shown;
  return { staleInHeader, shown, more, rows: shown + (more ? 1 : 0) };
}

/** The wall folds the recent-incidents row to one line once this many alert rows take its room. */
export const SQUEEZE_ROWS = 2;
