/**
 * The profile contract (Phase 5, frozen). A profile teaches Uptellis about one kind of system: which fact
 * groups and keys its producer sends, how to label and format them, when a value is a warning or critical,
 * which facts deserve a place in a theme's summary, and how facts shape the topology. A site enables
 * profiles in its config (`profiles`); `generic` is always active and renders any fact plainly. The
 * view-model and the themes never name a group or key themselves: they only read what profiles declare.
 */
import type { SiteConfig } from "../config";
import type { Fact } from "../model";
import type { Level, TopologyView } from "../view/types";

export type FactFormat =
  | "text"
  | "number"
  | "bytes" // number of bytes -> "73.7 MiB"
  | "duration" // seconds -> "18 s", "3 min"
  | "age" // timestamp in the past -> "27 min ago"
  | "until" // timestamp in the future -> "in 4 h", or "due now" when past
  | "percent" // 0..100 -> "16%" and a gauge
  | "bool" // true/false -> "yes"/"no" (or the key's `labels`)
  | "list" // comma or newline separated -> readable list
  | "timestamp"; // absolute UTC time

/** The current facts one source reports (contract addition), e.g. one node of a failover pair. */
export interface SourceFacts {
  /** The source id, e.g. `facts:app-2`. */
  source: string;
  /** The node the facts come from (`Profile.nodeOf`), else the source id's name (`facts:app-2` -> `app-2`). */
  node: string;
  /** Its current facts by `group.key`. */
  facts: ReadonlyMap<string, Fact>;
}

export interface ProfileContext {
  config: SiteConfig;
  nowMs: number;
  /**
   * Current facts by `group.key`, one per key: the newest observation across sources, unless an active
   * profile picks (`Profile.selectFacts`). With one facts source, simply that source's facts.
   */
  facts: ReadonlyMap<string, Fact>;
  /**
   * Each source's own current facts (contract addition), ordered by node then source id. Always set; a
   * context built without it (an older caller) gets the sources of `facts`.
   */
  sources: readonly SourceFacts[];
  /** True when the source's data is stale or has never arrived. */
  sourceStale(sourceId: string): boolean;
}

export interface FactKeyDef {
  key: string;
  label: string;
  format: FactFormat;
  /** Unit shown after numbers when the fact carries none. */
  unit?: string;
  /** Text for true/false (bool format), e.g. `["reachable", "unreachable"]`. */
  labels?: readonly [string, string];
  /** Folded into another row or only used for topology: kept in `factIndex`, left out of the group's rows. */
  hidden?: boolean;
  /**
   * Folded into this sibling key's row while that key is present (e.g. `total` into `online`): hidden
   * then, shown as its own row when the sibling is missing.
   */
  foldedInto?: string;
  /** Custom text for the value (e.g. `1 of 2` from a sibling); null falls back to `format`. */
  display?(fact: Fact, ctx: ProfileContext): string | null;
  /** The row's level from its value; null keeps the producer's severity. */
  level?(fact: Fact, ctx: ProfileContext): Level | null;
}

/**
 * One piece of a group's summary line (contract addition). `level` colours it: `ok`, `warn` and
 * `crit` as their state colours, `info` as secondary (muted) text, null as plain text. `emphasis` sets it
 * in bold (e.g. a fence decision). Themes render the parts in order with a space between them, so a
 * separator such as "·" is a part of its own.
 */
export interface SummaryPart {
  text: string;
  level: Level | null;
  emphasis?: boolean;
}

export interface FactGroupDef {
  id: string;
  title: string;
  /** Kit icon name for themes that show one. */
  icon?: string;
  /** Display order among all active profiles' groups (lower first). */
  order: number;
  keys: readonly FactKeyDef[];
  /** One line that sums the group up for a theme's compact row, e.g. "streaming lag 0 s · primary". */
  summary?(ctx: ProfileContext): string | null;
  /**
   * The summary as coloured parts (contract addition), e.g. "16.0.5", "·", "HTTP 200" (ok),
   * "·", "serving app-1" (info). Without `summary`, the line is the parts' texts joined by spaces;
   * without this hook, the view makes `summary` one plain part.
   */
  summaryParts?(ctx: ProfileContext): SummaryPart[] | null;
  /**
   * True when the profile's topology hook already draws this group's facts into the topology (contract
   * addition), e.g. the replication state and lag as the replication edge and the pair's card rows, or the
   * fence decision as the fence stamp. It gets the refined topology and is asked only when the site has one.
   * The view marks such a group `inTopology`, and a theme that draws that part of the topology may leave
   * the group out of its fact lists; a theme without a topology diagram keeps listing it.
   */
  inTopology?(topology: TopologyView): boolean;
  /**
   * True when the group describes one node, not the system (contract addition), e.g. a node's disk. When
   * more than one source reports it, the group lists every source's rows, each labelled with its node
   * (`FactRowView.node`); the rows of the source behind `ProfileContext.facts` keep their keys, the others
   * are keyed `<key>@<node>`. With one source nothing changes.
   */
  perNode?: boolean;
}

/** A fact a theme may place in its summary box, with a short label. */
export interface Highlight {
  fact: `${string}.${string}`;
  label: string;
  /** A short badge next to the value, e.g. "latest" or "2.6.0 available"; null for none. */
  note?(ctx: ProfileContext): { text: string; level: Level } | null;
  /**
   * Where the highlight sits in a theme's summary (contract addition): lower slots first, highlights
   * without one after them in profile order. The figures a theme draws itself from `SiteView.summary` hold
   * the slots in `SUMMARY_SLOTS` (monitors 10, avg response 20, health 40, uptime 24h 50, uptime 30d 60,
   * snapshot 80), so a highlight can sit between them, e.g. 30 after the average response.
   */
  slot?: number;
  /**
   * A short word before the value (contract addition), e.g. "db" for "db 41.2 MB" when the database size
   * is the detail of the Kuma slot; `label` names the slot, `prefix` the value within it.
   */
  prefix?: string;
}

export interface Profile {
  id: string;
  name: string;
  description: string;
  groups: readonly FactGroupDef[];
  highlights?: readonly Highlight[];
  /** One sentence about the system for a theme's summary, e.g. "Forgejo serving from app-1". */
  headline?(ctx: ProfileContext): string | null;
  /**
   * Refines the topology built from the site config (node states, notes, edge liveness and details, the
   * fence stamp) from this profile's facts. Profiles run in the order the site lists them.
   */
  topology?(ctx: ProfileContext, topology: TopologyView): TopologyView;
  /**
   * The node a source's facts come from (contract addition), e.g. its `forgejo.node`; null when they do
   * not say. The first active profile that names one wins.
   */
  nodeOf?(facts: ReadonlyMap<string, Fact>): string | null;
  /**
   * Picks the facts the view shows when several sources report (contract addition), e.g. the primary's of
   * a failover pair, from `ctx.sources`; `ctx.facts` holds the default (the newest per key). Returns the
   * map that becomes `ProfileContext.facts` for every hook, or null to keep the default. The first active
   * profile that picks wins. Not asked when only one source reports facts.
   */
  selectFacts?(ctx: ProfileContext): ReadonlyMap<string, Fact> | null;
  /** Path (in the repo) of the producer's install guide, e.g. `profiles/forgejo-ha/README.md`. */
  producerGuide?: string;
}
