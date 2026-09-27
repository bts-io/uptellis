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

export interface ProfileContext {
  config: SiteConfig;
  nowMs: number;
  /** Current facts by `group.key`. */
  facts: ReadonlyMap<string, Fact>;
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
  /** The row's level from its value; null keeps the producer's severity. */
  level?(fact: Fact, ctx: ProfileContext): Level | null;
}

export interface FactGroupDef {
  id: string;
  title: string;
  /** Kit icon name for themes that show one. */
  icon?: string;
  /** Display order among all active profiles' groups (lower first). */
  order: number;
  keys: readonly FactKeyDef[];
}

/** A fact a theme may place in its summary box, with a short label. */
export interface Highlight {
  fact: `${string}.${string}`;
  label: string;
}

export interface Profile {
  id: string;
  name: string;
  description: string;
  groups: readonly FactGroupDef[];
  highlights?: readonly Highlight[];
  /**
   * Refines the topology built from the site config (node states, notes, edge liveness and details, the
   * fence stamp) from this profile's facts. Profiles run in the order the site lists them.
   */
  topology?(ctx: ProfileContext, topology: TopologyView): TopologyView;
  /** Path (in the repo) of the producer's install guide, e.g. `profiles/forgejo-ha/README.md`. */
  producerGuide?: string;
}
