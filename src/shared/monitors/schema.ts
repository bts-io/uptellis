/**
 * Phase 6 contract (lead): native monitors in the site config. A monitor is one check (`http`, `tcp`,
 * `ping` or `tls`) that one or more runners perform on a schedule; their results are confirmed into one
 * service status (./confirm.ts). Changing a shape here needs the lead: every 6a stream codes against it.
 *
 * Runners:
 * - `builtin`: the Uptellis instance itself, from Cloudflare's edge (`http`, `tcp`) or from the Docker
 *   server (all four types). The same config works on both runtimes; a type the runtime cannot run is
 *   skipped by that runner (see `RUNNER_TYPES`), and the admin editor warns about it.
 * - an agent id declared in `agents`: `uptellis-agent` inside a private network (all four types).
 *
 * Each runner reports as its own source (`runnerSourceId`), so a silent agent raises a `stale` incident
 * like any other source. The service of a monitor is `probe:<monitor id>`; the legacy edge `probes` keep
 * their ids when they become monitors (`monitorsOf`), so their history carries over.
 */
import { z } from "zod";
import { Hostname, IsoTimestamp, ServiceId, type ServiceKind, type SourceId } from "../model/common";
import { containsForbiddenLiteral, safeDisplay } from "../model/safety";

export const MONITOR_TYPES = ["http", "tcp", "ping", "tls"] as const;
export const MonitorType = z.enum(MONITOR_TYPES);
export type MonitorType = z.infer<typeof MonitorType>;

/** The instance's own runner; every other runner is an agent id from `agents`. */
export const BUILTIN_RUNNER = "builtin";

/** Agent ids (the `<name>` of their source `probe:<name>`); `cf`, `server` and `builtin` are reserved. */
export const AgentId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "Expected an agent id like office-1")
  .refine((s) => !["cf", "server", BUILTIN_RUNNER].includes(s), { message: "Reserved agent id" });
export type AgentId = z.infer<typeof AgentId>;

export const RunnerId = z.union([z.literal(BUILTIN_RUNNER), AgentId]);
export type RunnerId = z.infer<typeof RunnerId>;

export type RunnerRuntime = "cloudflare" | "docker" | "agent";

/** Which monitor types each kind of runner performs (Workers have no ICMP and no peer certificate). */
export const RUNNER_TYPES: Record<RunnerRuntime, readonly MonitorType[]> = {
  cloudflare: ["http", "tcp"],
  docker: MONITOR_TYPES,
  agent: MONITOR_TYPES,
};

/** The source a runner reports as. `builtin` is `probe:cf` on Cloudflare (as before) and `probe:server` in Docker. */
export function runnerSourceId(runner: RunnerId, runtime: "cloudflare" | "docker"): SourceId {
  if (runner !== BUILTIN_RUNNER) return `probe:${runner}`;
  return runtime === "cloudflare" ? "probe:cf" : "probe:server";
}

/** Service kind a monitor shows as (`keyword` when an http monitor checks the body). */
export function monitorServiceKind(m: MonitorConfig): ServiceKind {
  switch (m.type) {
    case "http":
      return m.keyword ? "keyword" : "http";
    case "tcp":
      return "port";
    case "ping":
      return "ping";
    case "tls":
      return "tls";
  }
}

export const monitorServiceId = (monitorId: string): ServiceId => `probe:${monitorId}`;

const MonitorId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);

/** Suffixes of names that only resolve inside a LAN or tailnet. */
export const PRIVATE_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
  ".ts.net",
] as const;

/** A DNS hostname that resolves publicly (not an address literal, not a LAN or tailnet name). */
export const isPublicHost = (host: string) =>
  Hostname.safeParse(host).success && !PRIVATE_SUFFIXES.some((s) => `.${host}`.endsWith(s));

/**
 * Any host an agent may reach: a DNS name (public or private), a single-label name, or an IPv4/IPv6
 * literal. Private targets are allowed only on agent-only monitors and are never displayed.
 */
const AnyHost = z
  .string()
  .min(1)
  .max(253)
  .regex(/^(?:[A-Za-z0-9.-]+|\[?[0-9A-Fa-f:.]+\]?)$/, "Expected a hostname or an IP address");

const Port = z.number().int().min(1).max(65535);

const common = {
  id: MonitorId,
  name: safeDisplay(150),
  /** Whole minutes: the builtin runner fires once a minute. */
  intervalS: z
    .number()
    .int()
    .min(60)
    .max(3600)
    .refine((s) => s % 60 === 0, { message: "Interval must be whole minutes" })
    .default(60),
  /** Per attempt; a failing attempt is retried once after 2 s inside the same check (see ./check.ts). */
  timeoutS: z.number().int().min(1).max(30).default(10),
  /** Extra consecutive failed checks a runner needs before its failure counts (0: the first one does). */
  retries: z.number().int().min(0).max(10).default(1),
  runners: z
    .array(RunnerId)
    .min(1)
    .max(5)
    .refine((r) => new Set(r).size === r.length, { message: "Runners must be unique" })
    .default([BUILTIN_RUNNER]),
  /** Runners that must agree before the service is down; default a strict majority (1 of 1, 2 of 2, 2 of 3). */
  quorum: z.number().int().min(1).max(5).optional(),
  /** Paused monitors are not run and show `paused`. */
  enabled: z.boolean().default(true),
};

export const HttpMonitor = z.object({
  ...common,
  type: z.literal("http"),
  /** http or https; no credentials. Redirects are never followed. */
  url: z.url({ protocol: /^https?$/ }).refine(
    (u) => {
      const url = URL.parse(u);
      return !!url && !url.username && !url.password;
    },
    { message: "URL must not carry credentials" },
  ),
  method: z.enum(["GET", "HEAD"]).default("GET"),
  expectStatus: z
    .object({ min: z.number().int().min(100).max(599), max: z.number().int().min(100).max(599) })
    .refine((r) => r.min <= r.max, { message: "min must not exceed max" })
    .default({ min: 200, max: 399 }),
  /** Case-sensitive text the first 64 KiB of the body must contain (GET only). */
  keyword: z.string().min(1).max(100).optional(),
  /** Invert `keyword`: up when the text is absent. */
  keywordAbsent: z.boolean().default(false),
});

export const TcpMonitor = z.object({ ...common, type: z.literal("tcp"), host: AnyHost, port: Port });

export const PingMonitor = z.object({ ...common, type: z.literal("ping"), host: AnyHost });

export const TlsMonitor = z.object({
  ...common,
  type: z.literal("tls"),
  host: AnyHost,
  port: Port.default(443),
  /** SNI name when `host` is an address; defaults to `host`. */
  servername: Hostname.optional(),
  /** Days left under which the monitor is `degraded` (expired or an invalid chain is `down`). */
  minDays: z.number().int().min(0).max(365).default(7),
});

export const MonitorConfig = z
  .discriminatedUnion("type", [HttpMonitor, TcpMonitor, PingMonitor, TlsMonitor])
  .superRefine((m, ctx) => {
    if (m.quorum !== undefined && m.quorum > m.runners.length) {
      ctx.addIssue({ code: "custom", message: "Quorum exceeds the number of runners", path: ["quorum"] });
    }
    if (m.type === "http" && m.keyword && m.method === "HEAD") {
      ctx.addIssue({ code: "custom", message: "A keyword needs GET", path: ["keyword"] });
    }
    const host = monitorHost(m);
    if (m.runners.includes(BUILTIN_RUNNER) && !isPublicHost(host)) {
      ctx.addIssue({
        code: "custom",
        message: "Monitors run by builtin need a public hostname; use an agent for private targets",
        path: [m.type === "http" ? "url" : "host"],
      });
    }
  });
export type MonitorConfig = z.infer<typeof MonitorConfig>;
export type MonitorConfigInput = z.input<typeof MonitorConfig>;

/** The host a monitor connects to (the URL's host for http). */
export function monitorHost(m: Pick<MonitorConfig, "type"> & { url?: string; host?: string }): string {
  if (m.type === "http") return URL.parse(m.url ?? "")?.hostname.replace(/^\[|\]$/g, "") ?? "";
  return m.host ?? "";
}

/** What the page may show as a monitor's target: host (+ port or path) on a public name, else null. */
export function monitorTargetDisplay(m: MonitorConfig): string | null {
  if (!isPublicHost(monitorHost(m))) return null;
  let t: string;
  switch (m.type) {
    case "http": {
      const u = new URL(m.url);
      t = `${u.host}${u.pathname}`;
      break;
    }
    case "tcp":
      t = `${m.host}:${m.port}`;
      break;
    case "ping":
      t = m.host;
      break;
    case "tls":
      t = m.port === 443 ? m.host : `${m.host}:${m.port}`;
      break;
  }
  return containsForbiddenLiteral(t) ? null : t;
}

/** Strict majority of the configured runners unless `quorum` says otherwise. */
export const effectiveQuorum = (m: Pick<MonitorConfig, "runners" | "quorum">) =>
  m.quorum ?? Math.floor(m.runners.length / 2) + 1;

/** An agent a site accepts results from; its API key needs the `agent` scope. */
export const AgentDecl = z.object({ id: AgentId, name: safeDisplay(80) });
export type AgentDecl = z.infer<typeof AgentDecl>;

const Hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * A maintenance window: services inside it show `maintenance` (never downtime), open no incidents and page
 * nobody. `services` empty means every service of the site. One-off (`start` to `end`) or weekly.
 */
export const MaintenanceWindow = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("once"),
    id: MonitorId,
    title: safeDisplay(120),
    services: z.array(ServiceId).max(100).default([]),
    start: IsoTimestamp,
    end: IsoTimestamp,
  }),
  z.object({
    kind: z.literal("weekly"),
    id: MonitorId,
    title: safeDisplay(120),
    services: z.array(ServiceId).max(100).default([]),
    days: z.array(z.enum(WEEKDAYS)).min(1).max(7),
    /** Local start time in `timeZone`. */
    start: Hhmm,
    durationMin: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    /** IANA zone, e.g. `Europe/Paris`. */
    timeZone: z.string().min(1).max(64),
  }),
]);
export type MaintenanceWindow = z.infer<typeof MaintenanceWindow>;

/** The legacy edge probe (`SiteConfig.probes`), as an http monitor on `builtin` with no extra retries. */
export function probeAsMonitor(p: {
  id: string;
  name: string;
  url: string;
  method: "GET" | "HEAD";
  expectStatus: { min: number; max: number };
  timeoutS: number;
  intervalS: number;
}): MonitorConfig {
  return MonitorConfig.parse({ ...p, type: "http", retries: 0, runners: [BUILTIN_RUNNER] });
}

/**
 * Every monitor of a site: the configured `monitors` plus the legacy `probes`, migrated (a monitor with
 * the same id wins). This is the only way runners, the admin and the agent API read monitors.
 */
export function monitorsOf(config: {
  monitors: readonly MonitorConfig[];
  probes: readonly Parameters<typeof probeAsMonitor>[0][];
}): MonitorConfig[] {
  const ids = new Set(config.monitors.map((m) => m.id));
  return [...config.monitors, ...config.probes.filter((p) => !ids.has(p.id)).map(probeAsMonitor)];
}

/**
 * Whether a service belongs to a monitor the config no longer defines: a `probe:<id>` service whose id is
 * not in `monitorsOf(config)` (monitors plus migrated legacy probes; paused ones still count). Its rows stay
 * in the store; the view leaves it out and the five-minute job resolves its open `down` incident with
 * `REMOVED_MONITOR_NOTE` (src/worker/engine/incidents.ts). Services of any other kind are never removed
 * monitors.
 */
export function removedMonitorOf(config: Parameters<typeof monitorsOf>[0]): (serviceId: string) => boolean {
  const kept = new Set(monitorsOf(config).map((m) => monitorServiceId(m.id)));
  return (serviceId) => serviceId.startsWith("probe:") && !kept.has(serviceId);
}

/**
 * Whether a service belongs to a source the site no longer lists (a retired collector, Kuma instance or
 * webhook): its `source` is not in `config.sources`. Callers pass the effective list (`siteSources` in
 * src/worker/engine/sites.ts: configured plus the implied monitor runners), so a runner the config only
 * implies still counts as listed. A monitor's service (`probe:<id>`) never is: it follows its monitor
 * (`removedMonitorOf`), not its runner's source, so a paused monitor whose runner implies no source still
 * shows. Its rows stay in the store; the view leaves it out and the five-minute job resolves its open
 * `down` incident with `RETIRED_NOTE` (src/worker/engine/incidents.ts).
 */
export function retiredServiceOf(config: {
  sources: readonly { id: SourceId }[];
}): (service: { id: string; source: SourceId }) => boolean {
  const listed = new Set(config.sources.map((s) => s.id));
  return (service) => !service.id.startsWith("probe:") && !listed.has(service.source);
}
