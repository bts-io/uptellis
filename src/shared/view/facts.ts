/**
 * Fact presentation from the active profiles (src/shared/profiles): group titles, icons, order and summary
 * lines, row labels, formats, levels and folding. Nothing here names a group or key: a group no profile
 * declares, and a key its profile does not list, still render, with a humanised label and a format inferred
 * from the value's type and unit. A row's level is the worse of the producer's severity and the profile's.
 */
import { parseSiteConfig, type SiteConfig } from "../config";
import type { Fact } from "../model";
import { listProfiles } from "../profiles";
import type {
  FactFormat,
  FactGroupDef,
  FactKeyDef,
  Profile,
  ProfileContext,
  SourceFacts,
} from "../profiles/types";
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

/** A row of a per-node group: its node, and the key it is listed under (`<key>@<node>` unless shown as is). */
interface RowNode {
  node: string;
  key: string;
}

function factRow(
  f: Fact,
  def: FactKeyDef | undefined,
  ctx: ProfileContext,
  on: RowNode | null = null,
): FactRowView {
  const format = def?.format ?? inferFormat(f, ctx.nowMs);
  const percent =
    f.value.type === "number" && (format === "percent" || f.unit === "%")
      ? Math.max(0, Math.min(100, f.value.value))
      : null;
  const label = def?.label ?? humanize(f.key);
  return {
    group: f.group,
    key: on?.key ?? f.key,
    label: on ? `${label} (${on.node})` : label,
    display: def?.display?.(f, ctx) ?? formatValue(f, format, def, ctx.nowMs),
    level: worse(f.severity, def?.level?.(f, ctx) ?? null),
    percent,
    observedAt: f.observedAt,
    ...(on ? { node: on.node } : {}),
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
  /** Each source's current facts (see `currentFacts`); without them, the sources of the facts given. */
  sources?: readonly SourceFacts[];
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

/** The name after the kind in a source id: `facts:app-2` -> `app-2`. */
const sourceName = (id: string) => id.slice(id.indexOf(":") + 1) || id;

/**
 * Each source's current facts (the newest per `group.key` within the source), named by the first profile
 * whose `nodeOf` knows the node, else by the source id's name; ordered by node, then source id.
 */
export function factsBySource(
  facts: Iterable<Fact>,
  profiles: readonly Profile[] = listProfiles(),
): SourceFacts[] {
  const bySource = new Map<string, Fact[]>();
  for (const f of facts) {
    const list = bySource.get(f.source);
    if (list) list.push(f);
    else bySource.set(f.source, [f]);
  }
  return [...bySource]
    .map(([source, list]): SourceFacts => {
      const own = latestFacts(list);
      const node = profiles.reduce<string | null>((n, p) => n ?? p.nodeOf?.(own) ?? null, null);
      return { source, node: node ?? sourceName(source), facts: own };
    })
    .sort((a, b) => a.node.localeCompare(b.node) || a.source.localeCompare(b.source));
}

/** The facts a view shows: one per `group.key` (see `currentFacts`), and each source's own. */
export interface CurrentFacts {
  facts: Map<string, Fact>;
  sources: SourceFacts[];
}

/**
 * One fact per `group.key` and each source's own facts. With one facts source that is its facts; with
 * several, the first active profile whose `selectFacts` picks decides, else the newest per key wins.
 */
export function currentFacts(facts: readonly Fact[], ctx: FactViewContext): CurrentFacts {
  const profiles = ctx.profiles ?? listProfiles();
  const merged = latestFacts(facts);
  const sources = factsBySource(facts, profiles);
  if (sources.length < 2) return { facts: merged, sources };
  const base = profileContext(merged, { ...ctx, profiles, sources });
  for (const p of profiles) {
    const picked = p.selectFacts?.(base);
    if (picked) return { facts: new Map(picked), sources };
  }
  return { facts: merged, sources };
}

/** The context profile hooks see; `facts` is one current fact per `group.key`. */
export function profileContext(facts: ReadonlyMap<string, Fact>, ctx: FactViewContext): ProfileContext {
  return {
    config: ctx.config ?? standaloneConfig(ctx.thresholds),
    nowMs: ctx.nowMs,
    facts,
    sources: ctx.sources ?? factsBySource(facts.values(), ctx.profiles),
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

/**
 * The sources that report a per-node group (`FactGroupDef.perNode`), when more than one does; null for any
 * other group, which lists the facts given.
 */
function nodesOf(def: FactGroupDef | undefined, id: string, sources: readonly SourceFacts[]) {
  if (!def?.perNode) return null;
  const reporting = sources
    .map((s) => ({ node: s.node, members: membersOf(s.facts.values(), id) }))
    .filter((s) => s.members.size > 0);
  return reporting.length > 1 ? reporting : null;
}

/** A group's facts by key. */
function membersOf(facts: Iterable<Fact>, group: string): Map<string, Fact> {
  const out = new Map<string, Fact>();
  for (const f of facts) if (f.group === group) out.set(f.key, f);
  return out;
}

/**
 * Groups, rows, highlights and the headline for facts that are already one per `group.key` (see
 * `currentFacts`). A per-node group that several sources report lists each source's rows (see
 * `FactGroupDef.perNode`); it counts as fresh only while every node's newest row is, and its `observedAt`
 * is the stalest node's.
 */
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
      const pos = (key: string) => {
        const i = decl?.keys.findIndex((k) => k.key === key) ?? -1;
        return i === -1 ? Number.POSITIVE_INFINITY : i;
      };
      const newestOf = (list: readonly Fact[]) =>
        list.reduce((n, f) => (toMs(f.observedAt) > toMs(n.observedAt) ? f : n));
      const listed = (part: Map<string, Fact>, on: (f: Fact) => RowNode | null): FactRowView[] => {
        const rows: FactRowView[] = [];
        for (const f of part.values()) {
          const def = keyOf(f.key);
          const where = on(f);
          const row = factRow(f, def, pctx, where);
          index[`${id}.${where?.key ?? f.key}`] = row;
          const folded = def?.foldedInto !== undefined && part.has(def.foldedInto);
          if (!def?.hidden && !folded) rows.push(row);
        }
        return rows.sort((a, b) => pos(a.key) - pos(b.key) || a.label.localeCompare(b.label));
      };
      const nodes = nodesOf(decl?.def, id, ctx.sources ?? pctx.sources);
      // Per node: the rows of the fact the view shows keep their key, the other nodes' are `<key>@<node>`.
      const rows = nodes
        ? nodes.flatMap((n) =>
            listed(n.members, (f) => ({
              node: n.node,
              key: all.get(`${id}.${f.key}`)?.source === f.source ? f.key : `${f.key}@${n.node}`,
            })),
          )
        : listed(members, () => null);
      const newest = nodes
        ? nodes
            .map((n) => newestOf([...n.members.values()]))
            .reduce((o, f) => (toMs(f.observedAt) < toMs(o.observedAt) ? f : o))
        : newestOf([...members.values()]);
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
