/**
 * Kit contract (frozen for Phase 2): prop types of every `@/client/kit` component and the signatures of
 * `@/client/effects` hooks. The `kit` stream implements them; themes code against them. Kit components are
 * theme-agnostic: they style themselves only with the semantic tokens (`bg-panel`, `text-ink`,
 * `border-line`, `text-up`, ...) that each theme's token file overrides. They take view-model pieces or
 * primitives, never fetch, and render identically on the server and the client (no measured layout or
 * canvas outside `<ClientOnly>`). Documented with examples in docs/THEMES.md.
 */
import type { ReactNode } from "react";
import type {
  ActivityItem,
  BeatDay,
  BeatView,
  DisplayState,
  FactRowView,
  FreshnessView,
  IncidentView,
  Level,
  MaintenanceView,
  SummaryPartView,
  TopologyView,
  VerdictView,
} from "@/shared/view";

/** Block-letter wordmark (ansi_shadow figlet font) with the brand gradient; the text form is the accessible name. */
export interface BannerProps {
  text: string;
  /** Visually smaller variant for narrow screens. */
  compact?: boolean;
  /** Run the one-time decrypt effect (skipped under reduced motion and after the first run per session). */
  decrypt?: boolean;
  className?: string;
}

/** Box with the title set into its top border (`[ monitors ]`) and an optional `exit 0` / `exit 1` badge. */
export interface PanelProps {
  title: string;
  exitCode?: 0 | 1;
  /** Right side of the top border, e.g. a count or a timestamp. */
  aside?: ReactNode;
  /** Tints the border (e.g. `crit` for a failed fence). */
  level?: Level;
  id?: string;
  className?: string;
  children: ReactNode;
}

/** Coloured dot for a state; `pulse` for live states. */
export interface StateDotProps {
  state: DisplayState;
  pulse?: boolean;
  /** Accessible label; defaults to the state. */
  label?: string;
}

/** Overall verdict pill. */
export interface VerdictProps {
  verdict: VerdictView;
}

/** "fresh 34s" chip; the age ticks forward on the client from `ageS` at `now`. */
export interface FreshnessChipProps {
  freshness: FreshnessView;
  now: string;
}

/** Full-width alert shown when `freshness.state` is `stale` or `empty`; renders nothing otherwise. */
export interface StaleBannerProps {
  freshness: FreshnessView;
  now: string;
  /** Last snapshot time, shown as "showing data from HH:MM:SS UTC". */
  generatedAt: string;
}

/** Active maintenance windows (contract addition, Phase 6): `SiteView.maintenance` and `SiteView.now`. */
export interface MaintenanceNoticeProps {
  windows: MaintenanceView[] | undefined;
  now: string;
}

/**
 * 90 daily cells, oldest first. Cells are coloured by `worst`; `null` cells are a hatched no-data tail.
 * `text` (the `+~x=.` form) is the aria-label and the copy payload. Hover/focus shows day, uptime, minutes down.
 */
export interface BeatBarProps {
  days: BeatDay[];
  text: string;
  /** Cell height in px (default 18). */
  height?: number;
  className?: string;
}

/** Inline SVG latency path, SSR safe (fixed viewBox, no measuring). */
export interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
  level?: Level;
  /** Accessible summary, e.g. "latency 371 to 410 ms". */
  label: string;
}

/** Segmented gauge (CSS cells, exact widths): `value` 0..100 across `cells` cells. */
export interface GaugeProps {
  value: number | null;
  cells?: number;
  level?: Level;
  label: string;
}

/**
 * A fact group's summary line from its parts (`FactGroupView.summaryParts`, contract addition), a space
 * between them: a part's level colours it (`info` muted), `emphasis` sets it semibold. `stale` drops the
 * state colours, so old data never reads green.
 */
export interface SummaryPartsProps {
  parts: SummaryPartView[];
  stale?: boolean;
  className?: string;
}

/** Nodes with roles and state, edges (replication edge flows only while `live`), fence stamp. */
export interface TopologyTileProps {
  topology: TopologyView;
  /**
   * Label/value rows per node id for the pair's cards (e.g. `forgejo serving`, `disk 16%`); a node without
   * rows shows its state. `percent` draws a small gauge before the value, `state` a dot, `level` the colour.
   */
  rows?: Record<
    string,
    { label: string; value: string; state?: DisplayState; level?: Level; percent?: number }[]
  >;
  /** Small caps caption in the tile's top-left corner, e.g. "forgejo failover pair". */
  caption?: string;
  /** Muted line under the fence stamp; defaults to the fence reason. */
  fenceDetail?: string;
}

/** Rows with a 2px level rule, failures tinted; relative times tick from `now`. */
export interface ActivityFeedProps {
  items: ActivityItem[];
  now: string;
  /** Max rows (default all). */
  limit?: number;
  /** Two columns from the md breakpoint up. */
  columns?: 1 | 2;
  /** Latest checks listed after `items` in the same row design, the latency in the last column; `limit` counts both. */
  checks?: { id: string; service: string; beat: BeatView }[];
}

/** Open incident block with its step rail (detected, updates, resolved) and a live duration. */
export interface IncidentRailProps {
  incident: IncidentView;
  now: string;
}

/** Label/value rows of a fact group, with gauges for percentages and level colour per value. */
export interface FactListProps {
  rows: FactRowView[];
}

/** Key/value grid (the summary box): each item an icon name, a key and free content. */
export interface KeyValueGridProps {
  items: { icon: IconName; label: string; value: ReactNode }[];
  /** Columns from the lg breakpoint (one column on mobile). */
  columns?: 2 | 3;
}

/** Small inline outline icons (no icon font): the set the themes need. */
export type IconName =
  | "grid"
  | "bolt"
  | "box"
  | "heart"
  | "up"
  | "clock"
  | "host"
  | "camera"
  | "eye"
  | "server"
  | "database"
  | "shield"
  | "link"
  | "alert"
  | "check";

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

/** "Nothing here yet" with a reason (e.g. no sources have reported). */
export interface EmptyStateProps {
  title: string;
  detail?: string;
}

/** Real facts only: snapshot time, collector host, build commit, keyboard hints. No prompt lines. */
export interface FooterProps {
  generatedAt: string;
  collectorHost: string | null;
  commit: string | null;
  hints?: { keys: string; label: string }[];
}

/** Relative-time text that ticks on the client ("34s ago"); server renders the value at `now`. */
export interface AgeProps {
  /** The instant to measure from. */
  since: string;
  now: string;
  /** "ago" suffix (default true). */
  suffix?: boolean;
}

/** Effects (`@/client/effects`). All are no-ops on the server and respect reduced motion. */
export interface Effects {
  /** True when the user prefers reduced motion (false during SSR). */
  useReducedMotion(): boolean;
  /** Seconds elapsed since `since`, recomputed every `everyMs` (default 1000) while the tab is visible. */
  useAgeTicker(since: string, now: string, everyMs?: number): number;
  /** False while the document is hidden. */
  useVisibilityPause(): boolean;
  /** True only the first time `key` is seen in this browser session. */
  useSessionOnce(key: string): boolean;
  /** Scrambles `text` into place over `durationMs` once; returns the current frame text. */
  useDecrypt(text: string, opts?: { durationMs?: number; enabled?: boolean }): string;
  /** Draws katakana rain at `fps` into the canvas ref while visible and motion is allowed. */
  useMatrixRain(
    canvas: { current: HTMLCanvasElement | null },
    opts?: { fps?: number; enabled?: boolean },
  ): void;
  /** Returns true for `ms` after `value` changes (for a one-shot glow on state change). */
  useStateChangeGlow(value: unknown, ms?: number): boolean;
}

/**
 * Plain block header (theme C's command blocks): the title, the command that produced the block as a muted
 * tag, an aside (e.g. the data's age) and an `exit 0` / `exit 1` badge. No prompt, no `user@host`, no chevron.
 */
export interface BlockHeaderProps {
  title: string;
  /** Muted tag after the title, e.g. `monitors --beats 90d`. */
  command?: string;
  /** Right side before the badge, e.g. "41s ago" or "as of 23:58:00". */
  aside?: ReactNode;
  exitCode?: 0 | 1;
  /** The data behind the block is stale: the exit badge is drawn muted, since it vouches for nothing current. */
  stale?: boolean;
  /** `crit` tints the title (a failing block). */
  level?: Level;
  /** Id of the heading, for the block's `aria-labelledby`. */
  id?: string;
}
