/** Small readers over `ProfileContext.facts` for profile code: typed values by `group.key`, and freshness. */
import type { Fact } from "../model";
import { factFresh } from "../view/format";
import type { ProfileContext } from "./types";

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
