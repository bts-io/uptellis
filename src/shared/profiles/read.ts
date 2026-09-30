/**
 * Small readers over `ProfileContext.facts` for profile code: typed values by `group.key`, freshness, a
 * key's level, and builders for summary parts.
 */
import type { Fact } from "../model";
import { factFresh, formatRelative, toMs, worse } from "../view/format";
import type { Level } from "../view/types";
import type { FactGroupDef, ProfileContext, SummaryPart } from "./types";

export const str = (ctx: ProfileContext, key: string) => {
  const v = ctx.facts.get(key)?.value;
  return v?.type === "string" ? v.value : null;
};

export const num = (ctx: ProfileContext, key: string) => {
  const v = ctx.facts.get(key)?.value;
  return v?.type === "number" ? v.value : null;
};

export const bool = (ctx: ProfileContext, key: string) => {
  const v = ctx.facts.get(key)?.value;
  return v?.type === "boolean" ? v.value : null;
};

/** The value of a fact itself, by type (for `display` and `level` hooks). */
export const own = {
  str: (f: Fact) => (f.value.type === "string" ? f.value.value : null),
  num: (f: Fact) => (f.value.type === "number" ? f.value.value : null),
  bool: (f: Fact) => (f.value.type === "boolean" ? f.value.value : null),
};

/** True while the fact is inside its `freshForS` window and its source is not stale. */
export const current = (ctx: ProfileContext, f: Fact | undefined): f is Fact =>
  !!f && factFresh(f, ctx.nowMs) && !ctx.sourceStale(f.source);

/**
 * How long ago a fact that is no longer `current` was observed ("20 min ago"); null while it is current or
 * when it never arrived. For a last known value shown past its `freshForS` window.
 */
export function staleAge(ctx: ProfileContext, key: string): string | null {
  const f = ctx.facts.get(key);
  if (!f || (factFresh(f, ctx.nowMs) && !ctx.sourceStale(f.source))) return null;
  return formatRelative(Math.max(0, (ctx.nowMs - toMs(f.observedAt)) / 1000));
}

/**
 * A fact's text as its last known value: as is while the fact is current, else followed by its age
 * ("lag 0 s, 20 min ago"), so a stale value is marked, never replaced by a word that hides it.
 */
export function lastKnown(ctx: ProfileContext, key: string, text: string): string {
  const age = staleAge(ctx, key);
  return age === null ? text : `${text}, ${age}`;
}

/** A fact's level as its row shows it: the worse of the producer's severity and the key's `level` hook. */
export function keyLevel(ctx: ProfileContext, groups: readonly FactGroupDef[], key: string): Level | null {
  const f = ctx.facts.get(key);
  if (!f) return null;
  const def = groups.find((g) => g.id === f.group)?.keys.find((k) => k.key === f.key);
  return worse(f.severity, def?.level?.(f, ctx) ?? null);
}

/** Secondary text unless the level is a warning or a failure. */
export const quiet = (level: Level | null): Level => (level === "warn" || level === "crit" ? level : "info");

export const part = (text: string, level: Level | null = null, emphasis = false): SummaryPart => ({
  text,
  level,
  emphasis,
});

/** Runs of parts joined by a secondary "·"; missing parts and empty runs drop out; null when none is left. */
export function runs(...list: (SummaryPart | null | false)[][]): SummaryPart[] | null {
  const kept = list.map((r) => r.filter((p): p is SummaryPart => !!p)).filter((r) => r.length);
  return kept.length ? kept.flatMap((r, i) => (i ? [part("·", "info"), ...r] : r)) : null;
}
