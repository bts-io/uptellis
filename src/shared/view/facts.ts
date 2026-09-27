/**
 * Fact presentation: labels, row order, folded (hidden) rows and value formatting per known `group.key`,
 * for the groups the live producers send (profiles/forgejo-ha/push-facts.sh for `facts:*`, the kuma adapter for
 * `kuma`). Unknown groups and keys still render, with a humanized label and generic formatting by value
 * type and unit. A row's level is the worse of the producer's severity and the level derived here.
 */
import type { SiteConfig } from "../config";
import type { Fact } from "../model";
import { formatBytes, formatDuration, formatNumber, formatRelative, humanize, toMs } from "./format";
import type { FactGroupView, FactRowView, Level } from "./types";

export interface FactContext {
  nowMs: number;
  thresholds: SiteConfig["thresholds"];
  /** The other facts of the same group, by key. */
  siblings: ReadonlyMap<string, Fact>;
}

interface Shown {
  display?: string;
  level?: Level | null;
  percent?: number | null;
}

interface FactSpec {
  label: string;
  /** Folded into another row: kept in `factIndex`, left out of the group's rows. */
  hidden?: (ctx: FactContext) => boolean;
  format?: (f: Fact, ctx: FactContext) => Shown;
}

interface GroupSpec {
  title: string;
  /** Row order is the key order here. */
  keys: Record<string, FactSpec>;
}

const LEVEL_RANK: Record<Level, number> = { crit: 0, warn: 1, ok: 2, info: 3 };

/** The worse of two levels; `info` loses to any other level, null to anything. */
export function worse(a: Level | null, b: Level | null): Level | null {
  if (a === null) return b;
  if (b === null) return a;
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

const num = (f: Fact | undefined) => (f?.value.type === "number" ? f.value.value : null);
const str = (f: Fact | undefined) => (f?.value.type === "string" ? f.value.value : null);
const bool = (f: Fact | undefined) => (f?.value.type === "boolean" ? f.value.value : null);
/** Seconds from the fact's timestamp value to now (negative when it lies ahead). */
const sinceS = (f: Fact, ctx: FactContext) =>
  f.value.type === "timestamp" ? (ctx.nowMs - toMs(f.value.value)) / 1000 : null;
const has = (key: string) => (ctx: FactContext) => ctx.siblings.has(key);
const yesNo = (v: boolean) => (v ? "yes" : "no");
/** A boolean row that warns (or worse) when false. */
const flag =
  (whenFalse: Level, labels: [string, string] = ["yes", "no"]) =>
  (f: Fact): Shown => {
    const v = bool(f);
    return v === null ? {} : { display: v ? labels[0] : labels[1], level: v ? "ok" : whenFalse };
  };

export const FACT_GROUPS: Record<string, GroupSpec> = {
  forgejo: {
    title: "Forgejo",
    keys: {
      servingNode: {
        label: "Serving node",
        format: (f) => (str(f) === "none" ? { display: "none", level: "crit" } : {}),
      },
      version: { label: "Version" },
      healthzCode: {
        label: "Health check",
        format: (f) => {
          const code = num(f);
          return code === null ? {} : { display: `HTTP ${code}`, level: code === 200 ? "ok" : "crit" };
        },
      },
      healthzOk: { label: "Healthy", hidden: has("healthzCode"), format: flag("crit") },
      node: { label: "Reporting node" },
      serving: { label: "Running on reporting node" },
    },
  },
  replication: {
    title: "Replication",
    keys: {
      state: {
        label: "State",
        format: (f) => ({ level: str(f) === "streaming" ? "ok" : "warn" }),
      },
      lagSeconds: {
        label: "Lag",
        format: (f, { thresholds: t }) => {
          const lag = num(f);
          if (lag === null) return {};
          const level: Level = lag > t.lagCritS ? "crit" : lag > t.lagWarnS ? "warn" : "ok";
          return { display: formatDuration(lag), level };
        },
      },
      role: { label: "Reporting node role" },
      peer: { label: "Peer" },
      peerReachable: { label: "Peer reachable", format: flag("warn") },
      standbyConnected: { label: "Standby connected", format: flag("warn") },
    },
  },
  fence: {
    title: "Fence",
    keys: {
      decision: {
        label: "Decision",
        format: (f) => ({ level: str(f) === "serve" ? "ok" : "crit" }),
      },
      reason: { label: "Reason" },
      timeline: { label: "Timeline" },
      peerRole: { label: "Peer role" },
      peerTimeline: {
        label: "Peer timeline",
        format: (f, ctx) => {
          const ours = num(ctx.siblings.get("timeline"));
          return ours !== null && num(f) !== ours ? { level: "warn" } : {};
        },
      },
    },
  },
  backup: {
    title: "Backup",
    keys: {
      lastAt: {
        label: "Last backup",
        format: (f, ctx) => {
          const age = sinceS(f, ctx);
          if (age === null) return {};
          const tooOld = age > ctx.thresholds.backupMaxAgeH * 3600;
          // A timestamp a little ahead of the Worker clock (producer skew) reads as just now.
          return { display: formatRelative(Math.max(0, age)), level: tooOld ? "crit" : "ok" };
        },
      },
      lastResult: {
        label: "Result",
        format: (f) => {
          const v = str(f);
          return v === "ok"
            ? { level: "ok" }
            : v === "none"
              ? { display: "no backup yet", level: "warn" }
              : { level: "crit" };
        },
      },
      failedStep: { label: "Failed step", format: () => ({ level: "crit" }) },
      nextAt: {
        label: "Next backup",
        format: (f, ctx) => {
          const since = sinceS(f, ctx);
          if (since === null) return {};
          return since >= 0 ? { display: "due now", level: "warn" } : { display: formatRelative(since) };
        },
      },
      nextScheduled: { label: "Scheduled", format: flag("warn", ["yes", "not scheduled"]) },
      snapshot: { label: "Snapshot" },
      size: { label: "Size" },
      durationS: { label: "Duration" },
    },
  },
  runners: {
    title: "Runners",
    keys: {
      online: {
        label: "Online",
        format: (f, ctx) => {
          const online = num(f);
          const total = num(ctx.siblings.get("total"));
          if (online === null || total === null) return {};
          return { display: `${online} of ${total}`, level: online < total ? "warn" : "ok" };
        },
      },
      total: { label: "Total", hidden: has("online") },
      offline: {
        label: "Offline",
        format: (f) => (str(f) === "none" ? {} : { level: "warn" }),
      },
      list: {
        label: "Runners",
        // "watch-1 online, runner-1 offline" -> "watch-1 (online), runner-1 (offline)"
        format: (f) => {
          const v = str(f);
          if (v === null) return {};
          const items = v.split(", ").map((item) => {
            const at = item.lastIndexOf(" ");
            return at > 0 ? `${item.slice(0, at)} (${item.slice(at + 1)})` : item;
          });
          return { display: items.join(", ") };
        },
      },
    },
  },
  disk: {
    title: "Disk",
    keys: {
      percent: {
        label: "Root filesystem",
        format: (f) => {
          const p = num(f);
          if (p === null) return {};
          return { level: p >= 90 ? "crit" : p >= 80 ? "warn" : "ok" };
        },
      },
      display: { label: "Used" },
      usedBytes: { label: "Used", hidden: has("display") },
      sizeBytes: { label: "Size", hidden: has("display") },
    },
  },
  watchdog: {
    title: "Watchdog",
    keys: {
      reachable: {
        label: "Status page",
        format: (f, ctx) => {
          const v = bool(f);
          if (v === null) return {};
          const code = num(ctx.siblings.get("httpCode"));
          const text = v ? "reachable" : "unreachable";
          return { display: code === null ? text : `${text} (HTTP ${code})`, level: v ? "ok" : "warn" };
        },
      },
      httpCode: { label: "HTTP status", hidden: has("reachable") },
    },
  },
  kuma: {
    title: "Uptime Kuma",
    keys: {
      reachable: { label: "Reachable", format: flag("crit") },
      version: { label: "Version" },
      latestVersion: { label: "Latest version" },
      host: { label: "Host" },
      timezone: { label: "Timezone" },
      dbSize: { label: "Database size" },
    },
  },
};

/** Display order of fact groups; unknown groups follow alphabetically. */
export const FACT_GROUP_ORDER = Object.keys(FACT_GROUPS);

/** Formatting by value type and unit, for keys without a spec (and specs that leave the display alone). */
function genericDisplay(f: Fact, ctx: FactContext): string {
  const v = f.value;
  switch (v.type) {
    case "boolean":
      return yesNo(v.value);
    case "timestamp":
      return formatRelative((ctx.nowMs - toMs(v.value)) / 1000);
    case "string":
      return f.unit ? `${v.value} ${f.unit}` : v.value;
    case "number":
      if (f.unit === "%") return `${formatNumber(v.value)}%`;
      if (f.unit === "s") return formatDuration(v.value);
      if (f.unit === "bytes") return formatBytes(v.value);
      return f.unit ? `${formatNumber(v.value)} ${f.unit}` : formatNumber(v.value);
  }
}

function factRow(f: Fact, spec: FactSpec | undefined, ctx: FactContext): FactRowView {
  const shown = spec?.format?.(f, ctx) ?? {};
  const percent =
    f.unit === "%" && f.value.type === "number" ? Math.max(0, Math.min(100, f.value.value)) : null;
  return {
    group: f.group,
    key: f.key,
    label: spec?.label ?? humanize(f.key),
    display: shown.display ?? genericDisplay(f, ctx),
    level: worse(f.severity, shown.level ?? null),
    percent: shown.percent === undefined ? percent : shown.percent,
    observedAt: f.observedAt,
  };
}

/** True while a fact is inside its `freshForS` window at `nowMs`. */
export const factFresh = (f: Fact, nowMs: number) => nowMs - toMs(f.observedAt) <= f.freshForS * 1000;

export interface FactViews {
  groups: FactGroupView[];
  /** Every row by `group.key`, folded rows included. */
  index: Record<string, FactRowView>;
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

/** Groups and rows for facts that are already one per `group.key` (see `latestFacts`). */
export function buildFactViews(facts: Iterable<Fact>, ctx: Omit<FactContext, "siblings">): FactViews {
  const byGroup = new Map<string, Map<string, Fact>>();
  for (const f of facts) {
    const g = byGroup.get(f.group) ?? new Map<string, Fact>();
    g.set(f.key, f);
    byGroup.set(f.group, g);
  }
  const rank = (id: string) => {
    const i = FACT_GROUP_ORDER.indexOf(id);
    return i === -1 ? FACT_GROUP_ORDER.length : i;
  };

  const index: Record<string, FactRowView> = {};
  const groups = [...byGroup.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([id, members]): FactGroupView => {
      const spec = FACT_GROUPS[id];
      const order = spec ? Object.keys(spec.keys) : [];
      const gctx: FactContext = { ...ctx, siblings: members };
      const list = [...members.values()];
      const rows: FactRowView[] = [];
      for (const f of list) {
        const keySpec = spec?.keys[f.key];
        const row = factRow(f, keySpec, gctx);
        index[`${id}.${f.key}`] = row;
        if (!keySpec?.hidden?.(gctx)) rows.push(row);
      }
      const pos = (key: string) => {
        const i = order.indexOf(key);
        return i === -1 ? order.length : i;
      };
      rows.sort((a, b) => pos(a.key) - pos(b.key) || a.label.localeCompare(b.label));
      const newest = list.reduce((n, f) => (toMs(f.observedAt) > toMs(n.observedAt) ? f : n));
      return {
        id,
        title: spec?.title ?? humanize(id),
        level: rows.reduce<Level>(
          (w, r) => (r.level === null || r.level === "info" ? w : (worse(w, r.level) ?? w)),
          "ok",
        ),
        observedAt: newest.observedAt,
        fresh: factFresh(newest, ctx.nowMs),
        rows,
      };
    });
  return { groups, index };
}
