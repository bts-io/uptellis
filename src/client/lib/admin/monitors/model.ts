/**
 * What the Monitors dashboard and its drawers show and save, as plain functions of the config and the site
 * view (no React). Rows join the config's monitors (their names, settings and paused state) with the view's
 * services (state, uptime, checks); services other sources report (Uptime Kuma, facts, webhooks) are rows
 * too, read-only. A row's `serviceId` is only a key: it is never rendered.
 *
 * Config edits here return a new config (for `useSiteConfig().save`) and shape monitors exactly as the full
 * editor does (`newMonitor`, `withType` from ../MonitorsEditor), so either editor saves the same thing.
 */
import type { SiteConfig } from "@/shared/config";
import { sourceKindOf } from "@/shared/model";
import {
  BUILTIN_RUNNER,
  type MonitorConfig,
  monitorServiceId,
  monitorsOf,
  probeAsMonitor,
  type RunnerMonitorConfig,
} from "@/shared/monitors";
import type { DisplayState, IncidentView, ServiceView, SiteView } from "@/shared/view";
import type { AdminIconName } from "../icons";
import { newMonitor, withType } from "../MonitorsEditor";
import { serviceLabel } from "../names";

export type RunnerType = RunnerMonitorConfig["type"];
export type RowKind = RunnerType | "push" | "kuma" | "facts" | "webhook" | "probe";

export const KIND_LABEL: Record<RowKind, string> = {
  http: "HTTP",
  tcp: "TCP",
  ping: "Ping",
  tls: "TLS",
  push: "Heartbeat",
  kuma: "Uptime Kuma",
  facts: "Facts collector",
  webhook: "Webhook",
  probe: "Check",
};

export const KIND_ICON: Record<RowKind, AdminIconName> = {
  http: "http",
  tcp: "tcp",
  ping: "ping",
  tls: "tls",
  push: "heartbeat",
  kuma: "source",
  facts: "source",
  webhook: "source",
  probe: "source",
};

export interface MonitorRow {
  /** The service id: a React key and the drawers' handle, never shown. */
  serviceId: string;
  /** The config's monitor (a migrated legacy probe included); null for a service another source reports. */
  monitor: MonitorConfig | null;
  /** Whether the monitor sits under the config's legacy `probes` (saving it moves it to `monitors`). */
  legacy: boolean;
  service: ServiceView | null;
  kind: RowKind;
  name: string;
  /** Host, address or schedule under the name. */
  target: string;
  state: DisplayState;
  uptime24h: number | null;
  uptime7d: number | null;
  uptime30d: number | null;
  /** The last 30 days, oldest first ("none" for a day without data). */
  days: (DisplayState | "none")[];
  incidents: IncidentView[];
  /** Section titles the service is shown in on the status page, with its public name. */
  onPage: { sections: string[]; publicName: string };
}

const secondsLabel = (s: number) => {
  if (s % 86_400 === 0) return s === 86_400 ? "1 day" : `${s / 86_400} days`;
  if (s % 3600 === 0) return s === 3600 ? "1 hour" : `${s / 3600} hours`;
  if (s % 60 === 0) return s === 60 ? "1 minute" : `${s / 60} minutes`;
  return `${s} seconds`;
};

export { secondsLabel as durationWords };

/** `every minute`, `every 5 minutes`, `every hour`. */
export function every(s: number): string {
  if (s === 60) return "every minute";
  if (s === 3600) return "every hour";
  if (s === 86_400) return "every day";
  return `every ${secondsLabel(s)}`;
}

/** A rough duration in words: `40 seconds`, `12 minutes`, `3 hours`, `2 days`. */
export function roughly(sec: number): string {
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  if (sec < 60) return n(Math.max(0, Math.round(sec)), "second", "seconds");
  if (sec < 3600) return n(Math.round(sec / 60), "minute", "minutes");
  if (sec < 86_400) return n(Math.round(sec / 3600), "hour", "hours");
  return n(Math.round(sec / 86_400), "day", "days");
}

export const ago = (sec: number | null) => (sec === null ? "never" : `${roughly(sec)} ago`);

/** `99.95%`, rounded down so a bad day never shows as 100%; "No data" without a value. */
export function percent(r: number | null): string {
  if (r === null) return "No data";
  if (r >= 1) return "100%";
  return `${(Math.floor(r * 10_000) / 100).toFixed(2)}%`;
}

export const millis = (n: number | null) => (n === null ? "No reply" : `${Math.round(n)} ms`);

export const secondsSince = (iso: string, now: string) =>
  Math.max(0, (Date.parse(now) - Date.parse(iso)) / 1000);

/** The short form for sentences: "the Cloudflare edge or this server", "agent Head office". */
export const runnerShort = (id: string, agents: SiteConfig["agents"]) =>
  id === BUILTIN_RUNNER ? "the Cloudflare edge or this server" : runnerName(id, agents);

/** Where a check runs, in words: never the runner's id. */
export function runnerName(id: string, agents: SiteConfig["agents"]): string {
  if (id === BUILTIN_RUNNER) return "Cloudflare edge or this server";
  const a = agents.find((x) => x.id === id);
  return a ? `agent ${a.name}` : "an agent that is no longer set up";
}

function targetOf(m: MonitorConfig): string {
  switch (m.type) {
    case "http": {
      const u = URL.parse(m.url);
      return u ? `${u.host}${u.pathname === "/" ? "" : u.pathname}` : m.url;
    }
    case "tcp":
      return `${m.host}:${m.port}`;
    case "ping":
      return m.host;
    case "tls":
      return m.port === 443 ? m.host : `${m.host}:${m.port}`;
    case "push":
      return `Expected ${every(m.intervalS)}, grace ${secondsLabel(m.graceS)}`;
  }
}

function avg7(days: ServiceView["beats90d"]): number | null {
  const last = days.slice(-7).flatMap((d) => (d.uptime === null ? [] : [d.uptime]));
  return last.length ? last.reduce((a, b) => a + b, 0) / last.length : null;
}

/** Every service of the view, sectioned first, each once. */
export function viewServices(view: SiteView | null): ServiceView[] {
  if (!view) return [];
  const seen = new Map<string, ServiceView>();
  for (const s of [...view.sections.flatMap((x) => x.services), ...view.unsectioned])
    if (!seen.has(s.id)) seen.set(s.id, s);
  return [...seen.values()];
}

/** The dashboard's rows: the config's monitors in config order, then other sources' services. */
export function buildRows(config: SiteConfig, view: SiteView | null): MonitorRow[] {
  const services = new Map(viewServices(view).map((s) => [s.id, s]));
  const incidents = view ? [...view.incidents.open, ...view.incidents.recent] : [];
  const configured = new Set(config.monitors.map((m) => m.id));
  const onPage = (id: string, fallback: string) => ({
    sections: config.sections.filter((s) => s.services.includes(id)).map((s) => s.title),
    publicName: config.displayNames[id] ?? fallback,
  });
  const common = (id: string, s: ServiceView | null) => ({
    service: s,
    uptime24h: s?.uptime24h ?? null,
    uptime7d: s ? avg7(s.beats90d) : null,
    uptime30d: s?.uptime30d ?? null,
    days: s ? s.beats90d.slice(-30).map((d) => d.worst ?? ("none" as const)) : [],
    incidents: incidents.filter((i) => i.serviceId === id),
  });

  const rows: MonitorRow[] = monitorsOf(config).map((m) => {
    const id = monitorServiceId(m.id);
    const s = services.get(id) ?? null;
    return {
      serviceId: id,
      monitor: m,
      legacy: !configured.has(m.id),
      kind: m.type,
      name: serviceLabel(id, m.name),
      target: targetOf(m),
      state: !m.enabled ? "paused" : (s?.state ?? "pending"),
      onPage: onPage(id, serviceLabel(id, s?.name || m.name)),
      ...common(id, s),
    };
  });
  const taken = new Set(rows.map((r) => r.serviceId));
  for (const s of services.values()) {
    if (taken.has(s.id)) continue;
    const kind = sourceKindOf(s.id as Parameters<typeof sourceKindOf>[0]);
    rows.push({
      serviceId: s.id,
      monitor: null,
      legacy: false,
      kind,
      name: serviceLabel(s.id, s.name),
      target: s.targetDisplay ?? `Reported by ${KIND_LABEL[kind]}`,
      state: s.state,
      onPage: onPage(s.id, serviceLabel(s.id, s.name)),
      ...common(s.id, s),
    });
  }
  return rows;
}

const RANK: Record<DisplayState, number> = {
  down: 0,
  degraded: 1,
  stale: 1,
  pending: 2,
  up: 3,
  maintenance: 3,
  unknown: 3,
  paused: 4,
};

/** Down first, paused last; otherwise the config's order. */
export const sortRows = (rows: MonitorRow[]) =>
  rows
    .map((r, i) => [r, i] as const)
    .sort((a, b) => RANK[a[0].state] - RANK[b[0].state] || a[1] - b[1])
    .map(([r]) => r);

export interface DashboardStats {
  total: number;
  up: number;
  down: number;
  downNames: string[];
  paused: number;
  /** Mean 30-day uptime of everything not paused that has one. */
  uptime30d: number | null;
}

export function statsOf(rows: MonitorRow[]): DashboardStats {
  const running = rows.filter((r) => r.state !== "paused" && r.uptime30d !== null).map((r) => r.uptime30d!);
  const down = rows.filter((r) => r.state === "down");
  return {
    total: rows.length,
    up: rows.filter((r) => r.state === "up").length,
    down: down.length,
    downNames: down.map((r) => r.name),
    paused: rows.filter((r) => r.state === "paused").length,
    uptime30d: running.length ? running.reduce((a, b) => a + b, 0) / running.length : null,
  };
}

/* ------------------------------------------------------------------ */
/* The monitor form                                                    */
/* ------------------------------------------------------------------ */

/** The host (and port) typed in the address field, with or without a scheme or path. */
export function parseTarget(raw: string): { host: string; port: number | null } {
  const v = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `tcp://${v}`;
  const u = URL.parse(withScheme);
  if (!u) return { host: v.replace(/[/?#].*$/, "").replace(/:\d+$/, ""), port: null };
  const port = u.port ? Number(u.port) : null;
  return { host: u.hostname.replace(/^\[|\]$/g, ""), port };
}

/**
 * The check type what was typed suggests: a web address (`https://...`) is HTTP, a host with a port
 * (`db.example.com:5432`) TCP, a bare host name or address (`example.com`) ping, and a host with a path HTTP.
 */
export function inferType(raw: string): RunnerType {
  const v = raw.trim();
  if (!v || /^https?:\/\//i.test(v)) return "http";
  if (/^(?:\[[0-9a-f:.]+\]|[^\s:/]+):\d{1,5}$/i.test(v)) return "tcp";
  if (/[/?#]/.test(v)) return "http";
  return "ping";
}

/** The name a new monitor gets from its address until someone types one. */
export const nameFromTarget = (raw: string) => parseTarget(raw).host;

export interface MonitorDraft {
  target: string;
  type: RunnerType;
  name: string;
  intervalS: number;
  timeoutS: number;
  retries: number;
  runners: string[];
  quorum: number | undefined;
  method: "GET" | "HEAD";
  expectMin: number;
  expectMax: number;
  keyword: string;
}

/** The form's starting values: a new monitor's defaults, or the monitor being edited. */
export function draftOf(m: RunnerMonitorConfig | null): MonitorDraft {
  const base = m ?? (newMonitor([]) as RunnerMonitorConfig & { type: "http" });
  const http = base.type === "http" ? base : null;
  return {
    target: m === null ? "" : m.type === "http" ? m.url : m.type === "ping" ? m.host : `${m.host}:${m.port}`,
    type: base.type,
    name: m?.name ?? "",
    intervalS: base.intervalS,
    timeoutS: base.timeoutS,
    retries: base.retries,
    runners: [...base.runners],
    quorum: base.quorum,
    method: http?.method ?? "GET",
    expectMin: http?.expectStatus.min ?? 200,
    expectMax: http?.expectStatus.max ?? 399,
    keyword: http?.keyword ?? "",
  };
}

const drop = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/**
 * The monitor the form describes. `base` is the monitor being edited, or null for a new one (then it starts
 * as `newMonitor`, the full editor's "Add monitor"); fields the form does not show are kept.
 */
export function monitorFromDraft(
  base: MonitorConfig | null,
  d: MonitorDraft,
  taken: readonly MonitorConfig[],
): MonitorConfig {
  const start = base ?? newMonitor(taken);
  const typed = withType(start, d.type) as RunnerMonitorConfig;
  const target = d.target.trim();
  const { host, port } = parseTarget(target);
  const common = {
    name: d.name.trim(),
    intervalS: d.intervalS,
    timeoutS: d.timeoutS,
    retries: d.retries,
    runners: d.runners,
    quorum: d.runners.length > 1 ? d.quorum : undefined,
  };
  switch (typed.type) {
    case "http":
      return drop({
        ...typed,
        ...common,
        url: /^https?:\/\//i.test(target) ? target : `https://${target}`,
        method: d.method,
        expectStatus: { min: d.expectMin, max: d.expectMax },
        keyword: d.keyword || undefined,
        keywordAbsent: d.keyword ? typed.keywordAbsent : false,
      });
    case "tcp":
      return drop({ ...typed, ...common, host, port: port ?? typed.port });
    case "tls":
      return drop({ ...typed, ...common, host, port: port ?? 443 });
    case "ping":
      return drop({ ...typed, ...common, host });
  }
}

/** A new heartbeat as the full editor makes one (`newMonitor` turned into `push`), with its schedule. */
export function newHeartbeat(
  taken: readonly MonitorConfig[],
  v: { name: string; intervalS: number; graceS: number },
): MonitorConfig {
  const m = withType(newMonitor(taken), "push");
  return { ...m, name: v.name.trim(), intervalS: v.intervalS, graceS: v.graceS } as MonitorConfig;
}

/* ------------------------------------------------------------------ */
/* Config changes                                                      */
/* ------------------------------------------------------------------ */

/** Replaces the monitor with `m.id` (a legacy probe becomes a monitor of the same id), or appends it. */
export const upsertMonitor =
  (m: MonitorConfig) =>
  (c: SiteConfig): SiteConfig =>
    c.monitors.some((x) => x.id === m.id)
      ? { ...c, monitors: c.monitors.map((x) => (x.id === m.id ? m : x)) }
      : { ...c, monitors: [...c.monitors, m] };

/** Pauses or resumes a monitor (a legacy probe is written as a monitor of the same id). */
export const setEnabled =
  (id: string, enabled: boolean) =>
  (c: SiteConfig): SiteConfig => {
    const m = c.monitors.find((x) => x.id === id);
    if (m) return upsertMonitor({ ...m, enabled })(c);
    const p = c.probes.find((x) => x.id === id);
    return p ? upsertMonitor({ ...probeAsMonitor(p), enabled })(c) : c;
  };

/** Removes a monitor (or the legacy probe it came from). */
export const removeMonitor =
  (id: string) =>
  (c: SiteConfig): SiteConfig => ({
    ...c,
    monitors: c.monitors.filter((m) => m.id !== id),
    probes: c.probes.filter((p) => p.id !== id),
  });
