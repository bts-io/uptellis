/**
 * `buildSiteView`: the one pure function from stored model + config to what themes render.
 * No I/O, no clock reads (time comes from `input.now`), deterministic for a given input.
 *
 * Freshness: a configured source reports `fresh`, `aging`, `stale` or `empty` (never seen) at `now`.
 * A service whose source is stale or empty shows `stale` instead of its last status. The site's
 * freshness is the worst among sources that have reported; it is `empty` only when none has.
 *
 * Verdict precedence: `empty` (nothing reported) > `outage` (a service is down on current data) >
 * `stale` (a source is stale) > `degraded` > `operational`. A down service on a fresh source outranks
 * another source going stale, and stale services never count as down, so stale data cannot fake an outage.
 *
 * Removed monitors: a `probe:` service the config no longer defines (`removedMonitorOf`) is left out with
 * its heartbeats and incidents, as if it never existed; its rows stay in the store.
 */

import type { SiteConfig } from "../config";
import {
  FRESHNESS_FACTORS,
  type Heartbeat,
  type Incident,
  type Service,
  type ServiceStatus,
  type SourceFreshness,
  sourceAgeS,
  sourceFreshness,
} from "../model";
import { activeWindows } from "../monitors/maintenance";
import { removedMonitorOf } from "../monitors/schema";
import { activeProfiles } from "../profiles";
import { buildFactViews, latestFacts, profileContext } from "./facts";
import { clock, formatDuration, formatPercent, iso, mean, round, toMs } from "./format";
import type { DayCell, ViewInput } from "./input";
import { worstState } from "./state";
import { buildTopology } from "./topology";
import type {
  ActivityItem,
  BeatDay,
  BeatView,
  CertView,
  DisplayState,
  HealthView,
  IncidentView,
  Level,
  SectionView,
  ServiceView,
  SiteView,
  SourceView,
  VerdictState,
} from "./types";

export { FACT_GROUP_ORDER } from "./facts";

const DAY_MS = 86_400_000;
const BEAT_DAYS = 90;
const RECENT = 48;
const MAX_ACTIVITY = 40;

const FRESH_RANK: Record<SourceFreshness, number> = { empty: 0, stale: 1, aging: 2, fresh: 3 };

const byTsDesc = (a: { ts: string }, b: { ts: string }) => toMs(b.ts) - toMs(a.ts);
const numbers = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
const meanOf = (xs: (number | null)[], digits: number) => {
  const m = mean(numbers(xs));
  return m === null ? null : round(m, digits);
};

export function buildSiteView(input: ViewInput): SiteView {
  const { config } = input;
  const model = withoutRemovedMonitors(input.model, config);
  const nowMs = toMs(input.now);

  // Configured sources in config order. Services of a source the config does not list still get its
  // freshness from the model, so an unconfigured producer cannot keep a green dot either.
  const modelSource = new Map(model.sources.map((s) => [s.id, s]));
  const perSource: SourceView[] = config.sources.map((spec) => {
    const lastSeenAt = modelSource.get(spec.id)?.lastSeenAt ?? null;
    const src = { lastSeenAt, expectedIntervalS: spec.expectedIntervalS };
    const age = sourceAgeS(src, nowMs);
    return {
      id: spec.id,
      kind: spec.kind,
      expectedIntervalS: spec.expectedIntervalS,
      lastSeenAt,
      ageS: age === null ? null : Math.floor(age),
      freshness: sourceFreshness(src, nowMs),
    };
  });
  const freshnessOf = new Map<string, SourceFreshness>(perSource.map((s) => [s.id, s.freshness]));
  for (const s of model.sources) {
    if (!freshnessOf.has(s.id)) freshnessOf.set(s.id, sourceFreshness(s, nowMs));
  }
  const sourceStale = (id: string) => {
    const f = freshnessOf.get(id);
    return f === undefined || f === "stale" || f === "empty";
  };
  const reported = perSource.filter((s) => s.lastSeenAt !== null);
  const stalest = reported.reduce<SourceView | null>(
    (w, s) =>
      !w ||
      FRESH_RANK[s.freshness] < FRESH_RANK[w.freshness] ||
      (FRESH_RANK[s.freshness] === FRESH_RANK[w.freshness] && (s.ageS ?? 0) > (w.ageS ?? 0))
        ? s
        : w,
    null,
  );
  const freshState: SourceFreshness = stalest?.freshness ?? "empty";

  const beatsBy = groupBy(model.recentHeartbeats, (h) => h.serviceId);
  const daysBy = new Map(input.history.map((h) => [h.serviceId, h.days]));
  const openIncidents = uniqueIncidents(model.openIncidents.filter((i) => !i.endedAt));
  const openBy = new Map<string, string>();
  for (const i of [...openIncidents].sort((a, b) => toMs(a.startedAt) - toMs(b.startedAt))) {
    if (i.serviceId) openBy.set(i.serviceId, i.id);
  }

  // Maintenance outranks what was stored (and a stale source): the view shows it, the rows stay as they are.
  const windows = activeWindows(config, nowMs);
  const inWindow = (id: string) =>
    windows.some(({ window: w }) => w.services.length === 0 || w.services.includes(id));
  const siteWideWindow = windows.some(({ window: w }) => w.services.length === 0);

  const services = new Map<string, ServiceView>();
  for (const s of model.services) {
    const maint = inWindow(s.id);
    services.set(
      s.id,
      serviceView(maint ? { ...s, status: "maintenance" } : s, {
        config,
        nowMs,
        stale: !maint && sourceStale(s.source),
        beats: beatsBy.get(s.id) ?? [],
        days: daysBy.get(s.id) ?? [],
        openIncidentId: openBy.get(s.id) ?? null,
      }),
    );
  }

  const placed = new Set<string>();
  const sections: SectionView[] = config.sections.map((sec) => {
    const list = sec.services.flatMap((id) => {
      const v = services.get(id);
      if (v) placed.add(id);
      return v ? [v] : [];
    });
    return {
      id: sec.id,
      title: sec.title,
      state: worstState(list.map((v) => v.state)),
      exitCode: list.every((v) => v.state === "up" || v.state === "maintenance") ? 0 : 1,
      services: list,
    };
  });
  const all = [...services.values()];
  const count = (st: DisplayState) => all.filter((v) => v.state === st).length;
  const down = count("down");
  const degraded = count("degraded");
  const up = count("up");
  const maintenance = count("maintenance");

  const currentFacts = latestFacts(model.facts);
  const profiles = activeProfiles(config);
  const factCtx = { nowMs, thresholds: config.thresholds, config, profiles, sourceStale };
  const facts = buildFactViews(currentFacts.values(), factCtx);

  const nameOf = (id: string) => services.get(id)?.name ?? id;
  const subjectOf = (i: Incident) => (i.serviceId ? nameOf(i.serviceId) : (i.sourceId ?? i.id));
  const incidentView = (i: Incident) =>
    incidentViewOf(i, subjectOf(i), (i.serviceId && beatsBy.get(i.serviceId)) || [], nowMs);
  const recentIncidents = uniqueIncidents(model.recentIncidents.filter((i) => i.endedAt)).sort(
    (a, b) => toMs(b.endedAt ?? "") - toMs(a.endedAt ?? "") || a.id.localeCompare(b.id),
  );

  const verdictState: VerdictState =
    freshState === "empty"
      ? "empty"
      : down > 0
        ? "outage"
        : freshState === "stale" && !siteWideWindow
          ? "stale"
          : degraded > 0
            ? "degraded"
            : "operational";

  return {
    v: 1,
    now: iso(nowMs),
    generatedAt: newestSeen(model.sources) ?? model.generatedAt,
    site: { slug: config.slug, name: config.name, hostnames: config.hostnames },
    theme: config.theme,
    branding: {
      title: config.branding.title,
      tagline: config.branding.tagline ?? null,
      tokens: config.branding.tokens,
    },
    verdict: { state: verdictState, label: VERDICT_LABEL[verdictState](down, degraded), down, degraded },
    freshness: {
      state: freshState,
      ageS: freshState === "fresh" ? newestAge(reported) : (stalest?.ageS ?? null),
      stalestSourceId: stalest?.id ?? null,
      ...(siteWideWindow ? { quietForMaintenance: true } : {}),
      perSource,
    },
    summary: {
      total: all.length,
      up,
      down,
      degraded,
      maintenance,
      other: all.length - up - down - degraded - maintenance,
      avgLatencyMs: meanOf(
        all.map((v) => v.latencyMs),
        1,
      ),
      uptime24h: meanOf(
        all.map((v) => v.uptime24h),
        6,
      ),
      uptime30d: meanOf(
        all.map((v) => v.uptime30d),
        6,
      ),
      healthScore: meanOf(
        all.map((v) => v.health.score),
        1,
      ),
    },
    sections,
    unsectioned: all.filter((v) => !placed.has(v.id)),
    topology: buildTopology({
      topology: config.topology,
      profiles,
      ctx: profileContext(currentFacts, factCtx),
      services: all,
    }),
    factGroups: facts.groups,
    factIndex: facts.index,
    highlights: facts.highlights,
    headline: facts.headline,
    activity: buildActivity({
      beats: model.recentHeartbeats,
      incidents: uniqueIncidents([...openIncidents, ...recentIncidents]),
      sources: perSource,
      nameOf,
      subjectOf,
    }),
    incidents: {
      open: openIncidents.sort((a, b) => toMs(b.startedAt) - toMs(a.startedAt)).map(incidentView),
      recent: recentIncidents.map(incidentView),
    },
    links: config.links,
    maintenance: windows.map(({ window: w, start, end }) => ({
      id: w.id,
      title: w.title,
      services: w.services,
      start: iso(start),
      end: iso(end),
    })),
  };
}

const plural = (n: number, what: string) => `${n} ${n === 1 ? what : `${what}s`}`;
const VERDICT_LABEL: Record<VerdictState, (down: number, degraded: number) => string> = {
  operational: () => "All systems operational",
  degraded: (_, d) => `${plural(d, "service")} degraded`,
  outage: (d) => `${plural(d, "service")} down`,
  stale: () => "Data is stale",
  empty: () => "No data yet",
};

/** The newest `lastSeenAt` of any source: when the newest data was produced. */
/** The model without the services, heartbeats and incidents of monitors `config` no longer defines. */
function withoutRemovedMonitors(model: ViewInput["model"], config: SiteConfig): ViewInput["model"] {
  const removed = removedMonitorOf(config);
  const kept = (i: Incident) => !i.serviceId || !removed(i.serviceId);
  return {
    ...model,
    services: model.services.filter((s) => !removed(s.id)),
    recentHeartbeats: model.recentHeartbeats.filter((h) => !removed(h.serviceId)),
    openIncidents: model.openIncidents.filter(kept),
    recentIncidents: model.recentIncidents.filter(kept),
  };
}

function newestSeen(sources: readonly { lastSeenAt: string | null }[]) {
  return sources.reduce<string | null>(
    (n, s) => (s.lastSeenAt && (!n || toMs(s.lastSeenAt) > toMs(n)) ? s.lastSeenAt : n),
    null,
  );
}

/** First occurrence per id (the model's open and recent lists may overlap). */
function uniqueIncidents(list: readonly Incident[]): Incident[] {
  const seen = new Set<string>();
  return list.filter((i) => !seen.has(i.id) && !!seen.add(i.id));
}

/* ------------------------------------------------------------------ */
/* Services                                                            */
/* ------------------------------------------------------------------ */

interface ServiceContext {
  config: SiteConfig;
  nowMs: number;
  /** The service's source is stale or has never reported. */
  stale: boolean;
  beats: Heartbeat[];
  days: DayCell[];
  openIncidentId: string | null;
}

function serviceView(s: Service, ctx: ServiceContext): ServiceView {
  const cert = certView(s, ctx.config.thresholds, ctx.nowMs);
  const recent: BeatView[] = [...ctx.beats]
    .sort(byTsDesc)
    .slice(0, RECENT)
    .map((b) => ({
      ts: b.ts,
      status: b.status,
      latencyMs: b.latencyMs,
      message: b.message,
      important: b.important,
    }));
  const beats90d = beatDays(ctx.days, ctx.nowMs);
  // Sources that report no averages or uptime (the edge probes) get them from what is stored: the recent
  // beats' mean latency, today's cell for 24 h and the last 30 cells with data for 30 d.
  const withData = beats90d.filter((d) => d.uptime !== null);
  const derived: Service = {
    ...s,
    avgLatencyMs: s.avgLatencyMs ?? meanOrNull(numbers(recent.map((b) => b.latencyMs))),
    uptime24h: s.uptime24h ?? beats90d.at(-1)?.uptime ?? null,
    uptime30d: s.uptime30d ?? meanOrNull(withData.slice(-30).map((d) => d.uptime as number)),
  };
  return {
    id: s.id,
    name: ctx.config.displayNames[s.id] ?? s.name,
    kind: s.kind,
    targetDisplay: s.targetDisplay,
    method: s.method ?? null,
    intervalS: s.intervalS,
    timeoutS: s.timeoutS ?? null,
    status: s.status,
    state: ctx.stale ? "stale" : s.status,
    latencyMs: s.latencyMs,
    avgLatencyMs: derived.avgLatencyMs,
    uptime24h: derived.uptime24h,
    uptime30d: derived.uptime30d,
    cert,
    health: healthOf(derived, cert, ctx.config),
    beats90d,
    beatsText: beats90d.map((d) => BEAT_CHAR[d.worst ?? "none"]).join(""),
    recent,
    spark: numbers(recent.map((b) => b.latencyMs)).reverse(),
    openIncidentId: ctx.openIncidentId,
  };
}

/**
 * Days left are recounted from `validTo` at `now` (whole days, rounded down), so a stale snapshot never
 * shows a cert younger than it is. `crit` when invalid or at most `certCritDays` left, `warn` at most
 * `certWarnDays`.
 */
function certView(s: Service, t: SiteConfig["thresholds"], nowMs: number): CertView | null {
  if (!s.cert) return null;
  const daysRemaining = Math.floor((toMs(s.cert.validTo) - nowMs) / DAY_MS);
  const level: Level =
    !s.cert.valid || daysRemaining <= t.certCritDays
      ? "crit"
      : daysRemaining <= t.certWarnDays
        ? "warn"
        : "ok";
  return { ...s.cert, daysRemaining, level };
}

const BEAT_CHAR: Record<ServiceStatus | "none", string> = {
  up: "+",
  degraded: "~",
  pending: "~",
  down: "x",
  maintenance: "=",
  paused: ".",
  unknown: ".",
  none: ".",
};

/** Exactly 90 UTC days ending with today at `now`, oldest first; days without a cell are no-data. */
function beatDays(days: DayCell[], nowMs: number): BeatDay[] {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  return Array.from({ length: BEAT_DAYS }, (_, i) => {
    const day = iso(today - (BEAT_DAYS - 1 - i) * DAY_MS).slice(0, 10);
    const d = byDay.get(day);
    return d
      ? { day, worst: d.worst, uptime: d.uptime, minutesDown: d.minutesDown }
      : { day, worst: null, uptime: null, minutesDown: 0 };
  });
}

/**
 * Health score, 0..100: the weighted mean of the parts a service has, with the config's `health` weights
 * (renormalized over the parts present, so a service without a cert is scored on uptime and latency).
 *
 *   uptime  = 100 - (1 - u) * 2000, u = uptime30d (else uptime24h): 100 at 100%, 80 at 99%, 0 at 95%
 *   latency = 100 - max(0, latest / avg24h - 1) * 100: 100 at or under the average, 0 at double it;
 *             0 while the service is down (no answer)
 *   cert    = daysRemaining / (2 * certWarnDays) * 100, capped at 100; 0 when invalid or expired
 *
 * Each part is clamped to 0..100; the score has one decimal. Level: `crit` when down, the cert is `crit`
 * or the score is under 75, `warn` under 90 or with a cert warning, else `ok`.
 */
function healthOf(s: Service, cert: CertView | null, config: SiteConfig): HealthView {
  const w = config.health;
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const parts: { weight: number; score: number }[] = [];
  const reasons: string[] = [];
  if (s.status === "down") reasons.push("down now");

  const uptime = s.uptime30d ?? s.uptime24h;
  if (uptime !== null) {
    parts.push({ weight: w.uptime, score: clamp(100 - (1 - uptime) * 2000) });
    if (uptime < 1) reasons.push(`uptime ${s.uptime30d !== null ? "30d" : "24h"} ${formatPercent(uptime)}`);
  }
  if (s.status === "down") {
    parts.push({ weight: w.latency, score: 0 });
  } else if (s.latencyMs !== null && s.avgLatencyMs) {
    const ratio = s.latencyMs / s.avgLatencyMs;
    parts.push({ weight: w.latency, score: clamp(100 - Math.max(0, ratio - 1) * 100) });
    if (ratio > 1.1)
      reasons.push(`latency ${Math.round(s.latencyMs)} ms vs ${Math.round(s.avgLatencyMs)} ms avg`);
  }
  if (cert) {
    const full = 2 * config.thresholds.certWarnDays;
    parts.push({ weight: w.cert, score: cert.valid ? clamp((cert.daysRemaining / full) * 100) : 0 });
    if (!cert.valid) reasons.push("cert invalid");
    else if (cert.daysRemaining < 0) reasons.push("cert expired");
    else if (cert.level !== "ok") reasons.push(`cert expires in ${plural(cert.daysRemaining, "day")}`);
  }

  const total = parts.reduce((a, p) => a + p.weight, 0);
  const score = total > 0 ? round(parts.reduce((a, p) => a + p.score * p.weight, 0) / total, 1) : null;
  const level: Level =
    s.status === "down" || cert?.level === "crit" || (score !== null && score < 75)
      ? "crit"
      : cert?.level === "warn" || (score !== null && score < 90)
        ? "warn"
        : "ok";
  return { score, level, reasons };
}

/* ------------------------------------------------------------------ */
/* Activity and incidents                                              */
/* ------------------------------------------------------------------ */

const STATUS_LEVEL: Record<ServiceStatus, Level> = {
  up: "ok",
  down: "crit",
  degraded: "warn",
  pending: "warn",
  maintenance: "info",
  paused: "info",
  unknown: "info",
};
const STATUS_PHRASE: Record<ServiceStatus, string> = {
  up: "is up",
  down: "is down",
  degraded: "is degraded",
  pending: "is pending",
  maintenance: "is in maintenance",
  paused: "is paused",
  unknown: "is in an unknown state",
};

interface ActivityInput {
  beats: Heartbeat[];
  incidents: Incident[];
  sources: SourceView[];
  nameOf: (serviceId: string) => string;
  subjectOf: (i: Incident) => string;
}

/**
 * Status transitions (important beats), incidents opened and resolved, and sources going stale or
 * reporting again (from `stale` incidents; a source that is stale now without one yet gets a row at the
 * moment it crossed the stale line). A transition beat that opened or closed a `down` incident is left
 * out: the incident row says the same thing.
 */
function buildActivity(a: ActivityInput): ActivityItem[] {
  const items: ActivityItem[] = [];
  const edges = new Set<string>();
  for (const i of a.incidents) {
    if (i.kind !== "down" || !i.serviceId) continue;
    edges.add(`${i.serviceId}@${toMs(i.startedAt)}`);
    if (i.endedAt) edges.add(`${i.serviceId}@${toMs(i.endedAt)}`);
  }

  for (const b of a.beats) {
    if (!b.important || edges.has(`${b.serviceId}@${toMs(b.ts)}`)) continue;
    items.push({
      id: `status:${b.serviceId}:${b.ts}`,
      ts: b.ts,
      level: STATUS_LEVEL[b.status],
      kind: "status",
      serviceId: b.serviceId,
      sourceId: null,
      title: `${a.nameOf(b.serviceId)} ${STATUS_PHRASE[b.status]}`,
      message: b.message,
    });
  }

  const staleOpen = new Set<string>();
  for (const i of a.incidents) {
    const source = i.kind === "stale";
    if (source && !i.endedAt && i.sourceId) staleOpen.add(i.sourceId);
    const subject = a.subjectOf(i);
    items.push({
      id: `open:${i.id}`,
      ts: i.startedAt,
      level: source ? "warn" : "crit",
      kind: source ? "source" : "incident-open",
      serviceId: i.serviceId,
      sourceId: i.sourceId,
      title: source ? `${subject} stopped reporting` : i.title,
      message: i.notes,
    });
    if (i.endedAt) {
      const took = formatDuration((toMs(i.endedAt) - toMs(i.startedAt)) / 1000);
      items.push({
        id: `resolved:${i.id}`,
        ts: i.endedAt,
        level: "ok",
        kind: source ? "source" : "incident-resolved",
        serviceId: i.serviceId,
        sourceId: i.sourceId,
        title: source ? `${subject} reporting again` : `Resolved: ${i.title}`,
        message: `after ${took}`,
      });
    }
  }

  for (const s of a.sources) {
    if (s.freshness !== "stale" || !s.lastSeenAt || staleOpen.has(s.id)) continue;
    const crossed = toMs(s.lastSeenAt) + FRESHNESS_FACTORS.stale * s.expectedIntervalS * 1000;
    items.push({
      id: `stale:${s.id}:${s.lastSeenAt}`,
      ts: iso(crossed),
      level: "warn",
      kind: "source",
      serviceId: null,
      sourceId: s.id,
      title: `${s.id} went stale`,
      message: `last report at ${clock(s.lastSeenAt)} UTC`,
    });
  }

  return items.sort((x, y) => toMs(y.ts) - toMs(x.ts) || x.id.localeCompare(y.id)).slice(0, MAX_ACTIVITY);
}

/**
 * The incident rail, oldest first: detected, then every status transition of the service inside the
 * incident (e.g. a pending spell), then resolved. Duration runs to `endedAt`, or to `now` while open.
 */
function incidentViewOf(i: Incident, subject: string, beats: Heartbeat[], nowMs: number): IncidentView {
  const start = toMs(i.startedAt);
  const end = i.endedAt ? toMs(i.endedAt) : nowMs;
  const stale = i.kind === "stale";
  const steps: IncidentView["steps"] = [
    { ts: i.startedAt, label: stale ? "Stopped reporting" : "Detected", level: stale ? "warn" : "crit" },
  ];
  for (const b of beats) {
    const t = toMs(b.ts);
    if (b.important && t > start && t < end) {
      steps.push({ ts: b.ts, label: `${subject} ${STATUS_PHRASE[b.status]}`, level: STATUS_LEVEL[b.status] });
    }
  }
  if (i.endedAt) {
    steps.push({ ts: i.endedAt, label: stale ? "Reporting again" : "Resolved", level: "ok" });
  }
  steps.sort((a, b) => toMs(a.ts) - toMs(b.ts));
  return {
    id: i.id,
    kind: i.kind,
    serviceId: i.serviceId,
    sourceId: i.sourceId,
    subject,
    title: i.title,
    startedAt: i.startedAt,
    endedAt: i.endedAt,
    durationS: Math.max(0, Math.floor((end - start) / 1000)),
    notes: i.notes,
    steps,
  };
}

function groupBy<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** While every source is fresh the chip shows how new the newest data is, not the slowest probe's age. */
function newestAge(sources: SourceView[]): number | null {
  const ages = sources.flatMap((s) => (s.ageS === null ? [] : [s.ageS]));
  return ages.length ? Math.min(...ages) : null;
}

const meanOrNull = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
