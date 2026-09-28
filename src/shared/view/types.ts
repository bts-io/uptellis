/**
 * `SiteView`: everything a theme renders, built once by `buildSiteView` (pure, no I/O). Frozen for
 * Phase 2: streams code against these names; changing one needs the lead. Themes never see the raw
 * model, so a theme swap never touches data code.
 *
 * Conventions: timestamps are ISO strings (UTC); ratios are 0..1; ages and durations are seconds at
 * `SiteView.now`; lists are newest first unless a field says otherwise. Every string is display-safe
 * (the model's Zod schemas reject addresses, emails and tokens before anything is stored).
 */
import type { EdgeKind, NodeRole, ThemeId } from "../config";
import type {
  CertSummary,
  FactSeverity,
  IncidentKind,
  ServiceKind,
  ServiceStatus,
  SourceFreshness,
  SourceKind,
} from "../model";

/** How a thing is shown. `stale` replaces a service's status when its source is stale: stale data never keeps a green dot. */
export type DisplayState = ServiceStatus | "stale";

/** Severity level shared by facts, activity rows, cert and health hints. */
export type Level = FactSeverity;

export type VerdictState = "operational" | "degraded" | "outage" | "stale" | "empty";

export interface SiteView {
  v: 1;
  /** Evaluation time; themes tick ages forward from here on the client. */
  now: string;
  /** When the newest data in the model was produced (the "snapshot" time). */
  generatedAt: string;
  site: { slug: string; name: string; hostnames: string[] };
  theme: ThemeId;
  branding: { title: string; tagline: string | null; tokens: Record<string, string> };
  verdict: VerdictView;
  freshness: FreshnessView;
  summary: SummaryView;
  /** Config sections in config order; services in the section's order. Unknown ids are skipped. */
  sections: SectionView[];
  /** Services not placed in any section (so nothing silently disappears), in model order. */
  unsectioned: ServiceView[];
  topology: TopologyView | null;
  /**
   * Fact groups in the active profiles' order (`FactGroupDef.order`; groups no profile declares follow
   * alphabetically), rows in the profile's key order, then by label.
   */
  factGroups: FactGroupView[];
  /** `"<group>.<key>"` -> row, every current fact (folded and hidden rows included). */
  factIndex: Record<string, FactRowView>;
  /**
   * The facts the active profiles ask a theme to place in its summary (`Profile.highlights`), only those
   * with a current fact: by `slot`, lowest first, then those without a slot in profile order. Empty when
   * no active profile declares any.
   */
  highlights: HighlightView[];
  /** A sentence about the system from the first active profile that has one (`Profile.headline`), else null. */
  headline: string | null;
  /** Newest first, at most 40: status transitions, incidents opened and resolved, sources going stale. */
  activity: ActivityItem[];
  incidents: { open: IncidentView[]; recent: IncidentView[] };
  links: { label: string; href: string }[];
}

export interface VerdictView {
  state: VerdictState;
  /** Short human label, e.g. "All systems operational", "1 service down", "Data is stale". */
  label: string;
  down: number;
  degraded: number;
}

export interface FreshnessView {
  /** The worst freshness across configured sources (`empty` when none has reported). */
  state: SourceFreshness;
  /** Seconds: the newest data's age while every source is fresh, else the stalest source's age; null when none has reported. */
  ageS: number | null;
  stalestSourceId: string | null;
  perSource: SourceView[];
}

export interface SourceView {
  id: string;
  kind: SourceKind;
  expectedIntervalS: number;
  lastSeenAt: string | null;
  ageS: number | null;
  freshness: SourceFreshness;
}

export interface SummaryView {
  total: number;
  up: number;
  down: number;
  degraded: number;
  maintenance: number;
  /** pending, paused, unknown and stale. */
  other: number;
  /** Mean of services' latest latency, ms. */
  avgLatencyMs: number | null;
  /** Means over services that report them (ratios). */
  uptime24h: number | null;
  uptime30d: number | null;
  /** Mean of service health scores, 0..100. */
  healthScore: number | null;
}

export interface SectionView {
  id: string;
  title: string;
  /** Worst display state among its services (`unknown` when empty). */
  state: DisplayState;
  /** 0 when every service is up or in maintenance, else 1 (the `exit 0` / `exit 1` badge). */
  exitCode: 0 | 1;
  services: ServiceView[];
}

export interface ServiceView {
  id: string;
  /** Config `displayNames` override applied. */
  name: string;
  kind: ServiceKind;
  targetDisplay: string | null;
  method: string | null;
  intervalS: number | null;
  timeoutS: number | null;
  /** As reported by the source. */
  status: ServiceStatus;
  /** What to show: `status`, or `stale` when the service's source is stale or empty. */
  state: DisplayState;
  latencyMs: number | null;
  avgLatencyMs: number | null;
  uptime24h: number | null;
  uptime30d: number | null;
  cert: CertView | null;
  health: HealthView;
  /** Exactly 90 cells, oldest first, ending today (UTC). Days without data are `{ worst: null }`. */
  beats90d: BeatDay[];
  /** One char per `beats90d` cell: `+` up, `~` degraded or pending, `x` down, `=` maintenance, `.` no data. aria-label and copy payload. */
  beatsText: string;
  /** Newest first, at most 48. */
  recent: BeatView[];
  /** Latency points, oldest first (from `recent`, nulls dropped), for the sparkline. */
  spark: number[];
  openIncidentId: string | null;
}

export interface BeatDay {
  day: string;
  worst: ServiceStatus | null;
  uptime: number | null;
  minutesDown: number;
}

export interface BeatView {
  ts: string;
  status: ServiceStatus;
  latencyMs: number | null;
  message: string | null;
  important: boolean;
}

export interface CertView extends CertSummary {
  /** From `thresholds.certWarnDays` / `certCritDays`; `crit` also when invalid. */
  level: Level;
}

export interface HealthView {
  /** 0..100 from the config `health` weights (uptime, latency, cert); null when nothing to score. */
  score: number | null;
  level: Level;
  /** Short reasons for points lost, e.g. "uptime 30d 99.86%", "cert expires in 9 days". */
  reasons: string[];
}

export interface TopologyView {
  nodes: {
    id: string;
    label: string;
    roles: NodeRole[];
    location: string | null;
    /** From facts where known (e.g. the serving node), else `unknown`. */
    state: DisplayState;
    /** e.g. "serving", "standby", "watchdog". */
    note: string | null;
    /** Rows for the node's card from the profiles (e.g. forgejo serving, postgres primary); empty when none. */
    details: { label: string; value: string; state: DisplayState | null }[];
  }[];
  edges: {
    from: string;
    to: string;
    kind: EdgeKind;
    label: string | null;
    /** A replication edge is live only while replication reports streaming (the edge animates only then). */
    live: boolean;
    /** e.g. "lag 0 s". */
    detail: string | null;
  }[];
  /** From the `fence` fact group; null when the site has no fence facts. */
  fence: { decision: string; reason: string | null; level: Level } | null;
}

export interface HighlightView {
  /** Short label for the summary slot, e.g. "kuma", "db", "collector". */
  label: string;
  row: FactRowView;
  /** A short badge the profile adds to the value (`Highlight.note`), e.g. "latest"; null for none. */
  note: { text: string; level: Level } | null;
  /** Its place in the summary (`Highlight.slot`, contract addition); null when the profile gives none. */
  slot: number | null;
  /** A short word before the value (`Highlight.prefix`, contract addition), e.g. "db"; null for none. */
  prefix: string | null;
}

export interface FactGroupView {
  id: string;
  title: string;
  /** Kit icon name from the profile (`FactGroupDef.icon`); null for groups no profile declares. */
  icon: string | null;
  /** One line that sums the group up (`FactGroupDef.summary`), for compact rows; null when none. */
  summary: string | null;
  /**
   * The same line as parts coloured by level (contract addition), from `FactGroupDef.summaryParts`,
   * else `summary` as one plain part; empty when the group has no summary. Render them in order with a
   * space between: a non-null `level` colours a part (`info` is secondary text), `emphasis` sets it bold.
   */
  summaryParts: SummaryPartView[];
  /** Worst row severity (`info` rows do not raise it). */
  level: Level;
  observedAt: string;
  /** False once the newest row is older than its `freshForS`. */
  fresh: boolean;
  rows: FactRowView[];
}

/** One piece of a group's summary line (see `FactGroupView.summaryParts`). */
export interface SummaryPartView {
  text: string;
  level: Level | null;
  emphasis: boolean;
}

export interface FactRowView {
  group: string;
  key: string;
  label: string;
  /** Formatted value with unit, e.g. "73.7 MiB", "12 min ago", "streaming". */
  display: string;
  level: Level | null;
  /** 0..100 when the fact is a percentage (drives a gauge). */
  percent: number | null;
  observedAt: string;
}

export interface ActivityItem {
  id: string;
  ts: string;
  level: Level;
  kind: "status" | "incident-open" | "incident-resolved" | "source";
  serviceId: string | null;
  sourceId: string | null;
  title: string;
  message: string | null;
}

export interface IncidentView {
  id: string;
  kind: IncidentKind;
  serviceId: string | null;
  sourceId: string | null;
  /** Service display name or source id. */
  subject: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  /** To `endedAt`, or to `now` while open. */
  durationS: number;
  notes: string | null;
  /** The incident rail: detected, (updates), resolved; oldest first. */
  steps: { ts: string; label: string; level: Level }[];
}
