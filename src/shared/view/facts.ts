/**
 * Fact presentation from the active profiles (src/shared/profiles): group titles, icons, order and summary
 * lines, row labels, formats, levels and folding. Nothing here names a group or key: a group no profile
 * declares, and a key its profile does not list, still render, with a humanised label and a format inferred
 * from the value's type and unit. A row's level is the worse of the producer's severity and the profile's.
 */
import { parseSiteConfig, type SiteConfig } from "../config";
import type { Fact } from "../model";
import { listProfiles } from "../profiles";
import type { FactFormat, FactGroupDef, FactKeyDef, Profile, ProfileContext } from "../profiles/types";
import {
  factFresh,
  formatBytes,
  formatDuration,
  formatNumber,
  formatRelative,
  humanize,
  iso,
  toMs,
  worse,
} from "./format";
import type {
  FactGroupView,
  FactRowView,
  HighlightView,
  Level,
  SummaryPartView,
  TopologyView,
} from "./types";

/** Display order of the built-in profiles' groups (`FactGroupDef.order`); undeclared groups follow alphabetically. */
export const FACT_GROUP_ORDER = listProfiles()
  .flatMap((p) => p.groups)
  .sort((a, b) => a.order - b.order)
  .map((g) => g.id);

/** The format a key without a definition gets from its value's type and unit. */
function inferFormat(f: Fact, nowMs: number): FactFormat {
  const v = f.value;
  switch (v.type) {
    case "boolean":
      return "bool";
    case "timestamp":
      return toMs(v.value) <= nowMs ? "age" : "until";
    case "string":
      return "text";
    case "number":
      return f.unit === "%"
        ? "percent"
        : f.unit === "s"
          ? "duration"
          : f.unit === "bytes"
            ? "bytes"
            : "number";
  }
}

/**
 * The value as text in `format`. A format that does not fit the value's type (bytes on a string such as
 * "1.2 GiB") falls back to the inferred one.
 */
function formatValue(f: Fact, format: FactFormat, def: FactKeyDef | undefined, nowMs: number): string {
  const v = f.value;
  const unit = f.unit ?? def?.unit ?? null;
  const withUnit = (s: string) => (unit ? `${s} ${unit}` : s);
  const inferred = () => formatValue(f, inferFormat(f, nowMs), undefined, nowMs);
  switch (format) {
    case "text":
      return v.type === "string" ? withUnit(v.value) : inferred();
    case "list":
      return v.type === "string"
        ? v.value
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter(Boolean)
            .join(", ")
        : inferred();
    case "number":
      return v.type === "number" ? withUnit(formatNumber(v.value)) : inferred();
    case "percent":
      return v.type === "number" ? `${formatNumber(v.value)}%` : inferred();
    case "bytes":
      return v.type === "number" ? formatBytes(v.value) : inferred();
    case "duration":
      return v.type === "number" ? formatDuration(v.value) : inferred();
    case "bool": {
      if (v.type !== "boolean") return inferred();
      const [yes, no] = def?.labels ?? ["yes", "no"];
      return v.value ? yes : no;
    }
    case "age":
    case "until":
    case "timestamp": {
      if (v.type !== "timestamp") return inferred();
      const since = (nowMs - toMs(v.value)) / 1000;
      if (format === "timestamp") return `${iso(toMs(v.value)).replace("T", " ").replace("Z", "")} UTC`;
      // A timestamp a little ahead of the clock (producer skew) reads as just now.
      if (format === "age") return formatRelative(Math.max(0, since));
      return since >= 0 ? "due now" : formatRelative(since);
    }
  }
}

function factRow(f: Fact, def: FactKeyDef | undefined, ctx: ProfileContext): FactRowView {
  const format = def?.format ?? inferFormat(f, ctx.nowMs);
  const percent =
    f.value.type === "number" && (format === "percent" || f.unit === "%")
      ? Math.max(0, Math.min(100, f.value.value))
      : null;
  return {
    group: f.group,
    key: f.key,
    label: def?.label ?? humanize(f.key),
    display: def?.display?.(f, ctx) ?? formatValue(f, format, def, ctx.nowMs),
    level: worse(f.severity, def?.level?.(f, ctx) ?? null),
    percent,
    observedAt: f.observedAt,
  };
}

export interface FactViewContext {
  nowMs: number;
  thresholds: SiteConfig["thresholds"];
  /** The site's config; without one (a standalone call) a minimal config carrying `thresholds` stands in. */
  config?: SiteConfig;
  /** Active profiles in order (see `activeProfiles`); every registered profile when left out. */
  profiles?: readonly Profile[];
  /** True when the source's data is stale or has never arrived; never when left out. */
  sourceStale?: (sourceId: string) => boolean;
}

export interface FactViews {
  groups: FactGroupView[];
  /** Every row by `group.key`, folded rows included. */
  index: Record<string, FactRowView>;
  highlights: HighlightView[];
  headline: string | null;
}

/** One fact per `group.key`: the newer observation wins when two sources report the same key. */
export function latestFacts(facts: readonly Fact[]): Map<string, Fact> {
  const out = new Map<string, Fact>();
  for (const f of facts) {
    const k = `${f.group}.${f.key}`;
    const prev = out.get(k);
    if (!prev || toMs(f.observedAt) > toMs(prev.observedAt)) out.set(k, f);
  }
  return out;
}

/** The context profile hooks see; `facts` is one current fact per `group.key`. */
export function profileContext(facts: ReadonlyMap<string, Fact>, ctx: FactViewContext): ProfileContext {
  return {
    config: ctx.config ?? standaloneConfig(ctx.thresholds),
    nowMs: ctx.nowMs,
    facts,
    sourceStale: ctx.sourceStale ?? (() => false),
  };
}

const standaloneConfig = (thresholds: SiteConfig["thresholds"]) =>
  parseSiteConfig({
    v: 1,
    slug: "standalone",
    name: "Standalone",
    hostnames: ["standalone.example.com"],
    theme: "a-sys-status",
    sources: [],
    sections: [],
    branding: { title: "Standalone" },
    thresholds,
  });

/** One group as the profiles declare it: the first declaration's title, icon, order and summary, every key. */
interface GroupDecl {
  def: FactGroupDef;
  keys: FactKeyDef[];
}

function declarations(profiles: readonly Profile[]): Map<string, GroupDecl> {
  const out = new Map<string, GroupDecl>();
  for (const p of profiles) {
    for (const g of p.groups) {
      const decl = out.get(g.id) ?? { def: g, keys: [] };
      for (const k of g.keys) if (!decl.keys.some((x) => x.key === k.key)) decl.keys.push(k);
      out.set(g.id, decl);
    }
  }
  return out;
}

/** A group's summary line and its parts: each derived from the other when the profile gives only one. */
function summaryOf(
  def: FactGroupDef | undefined,
  ctx: ProfileContext,
): Pick<FactGroupView, "summary" | "summaryParts"> {
  const given = def?.summaryParts?.(ctx);
  const text = def?.summary?.(ctx) ?? null;
  if (given?.length) {
    const summaryParts = given.map(
      (p): SummaryPartView => ({ text: p.text, level: p.level, emphasis: p.emphasis ?? false }),
    );
    return { summary: text ?? summaryParts.map((p) => p.text).join(" "), summaryParts };
  }
  return { summary: text, summaryParts: text === null ? [] : [{ text, level: null, emphasis: false }] };
}

/**
 * Marks the groups the topology already draws (`FactGroupDef.inTopology`, asked with the refined topology);
 * every group stays unmarked when the site has no topology.
 */
export function markTopologyGroups(
  groups: readonly FactGroupView[],
  topology: TopologyView | null,
  profiles: readonly Profile[] = listProfiles(),
): FactGroupView[] {
  const decls = declarations(profiles);
  return groups.map((g) => ({
    ...g,
    inTopology: topology !== null && decls.get(g.id)?.def.inTopology?.(topology) === true,
  }));
}

/** Groups, rows, highlights and the headline for facts that are already one per `group.key` (see `latestFacts`). */
export function buildFactViews(facts: Iterable<Fact>, ctx: FactViewContext): FactViews {
  const profiles = ctx.profiles ?? listProfiles();
  const all = new Map<string, Fact>();
  const byGroup = new Map<string, Map<string, Fact>>();
  for (const f of facts) {
    all.set(`${f.group}.${f.key}`, f);
    const g = byGroup.get(f.group) ?? new Map<string, Fact>();
    g.set(f.key, f);
    byGroup.set(f.group, g);
  }
  const pctx = profileContext(all, ctx);
  const decls = declarations(profiles);
  const rank = (id: string) => decls.get(id)?.def.order ?? Number.POSITIVE_INFINITY;

  const index: Record<string, FactRowView> = {};
  const groups = [...byGroup.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([id, members]): FactGroupView => {
      const decl = decls.get(id);
      const keyOf = (key: string) => decl?.keys.find((k) => k.key === key);
      const list = [...members.values()];
      const rows: FactRowView[] = [];
      for (const f of list) {
        const def = keyOf(f.key);
        const row = factRow(f, def, pctx);
        index[`${id}.${f.key}`] = row;
        const folded = def?.foldedInto !== undefined && members.has(def.foldedInto);
        if (!def?.hidden && !folded) rows.push(row);
      }
      const pos = (key: string) => {
        const i = decl?.keys.findIndex((k) => k.key === key) ?? -1;
        return i === -1 ? Number.POSITIVE_INFINITY : i;
      };
      rows.sort((a, b) => pos(a.key) - pos(b.key) || a.label.localeCompare(b.label));
      const newest = list.reduce((n, f) => (toMs(f.observedAt) > toMs(n.observedAt) ? f : n));
      return {
        id,
        title: decl?.def.title ?? humanize(id),
        icon: decl?.def.icon ?? null,
        ...summaryOf(decl?.def, pctx),
        level: rows.reduce<Level>(
          (w, r) => (r.level === null || r.level === "info" ? w : (worse(w, r.level) ?? w)),
          "ok",
        ),
        observedAt: newest.observedAt,
        fresh: factFresh(newest, ctx.nowMs),
        inTopology: false,
        rows,
      };
    });

  const seen = new Set<string>();
  const highlights: HighlightView[] = [];
  for (const h of profiles.flatMap((p) => p.highlights ?? [])) {
    const row = index[h.fact];
    if (row && !seen.has(h.fact)) {
      seen.add(h.fact);
      highlights.push({
        label: h.label,
        row,
        note: h.note?.(pctx) ?? null,
        slot: h.slot ?? null,
        prefix: h.prefix ?? null,
      });
    }
  }
  // Stable: equal slots, and highlights without one, keep the profile order.
  const slotOf = (h: HighlightView) => h.slot ?? Number.POSITIVE_INFINITY;
  highlights.sort((a, b) => slotOf(a) - slotOf(b));
  let headline: string | null = null;
  for (const p of profiles) {
    headline = p.headline?.(pctx) ?? null;
    if (headline !== null) break;
  }
  return { groups, index, highlights, headline };
}
