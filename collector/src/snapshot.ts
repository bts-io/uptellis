// Builds the `KumaSnapshot` payload from the in-memory state, maps addresses to host names and scrubs
// the rest, then `guardSnapshot` refuses anything that still carries a forbidden literal or fails the
// shared Zod schema (fail closed: the caller logs field paths and never sends it).
import { findLiteralPaths, type HostAliases, sanitizeText, stripUrlCredentials } from "./address";
import { type CertSummary, INGEST_LIMITS, type KumaBeat, type KumaMonitor, KumaSnapshot } from "./shared";
import type { Beat, CertRaw, KumaState, MonitorConfig } from "./state";

export interface SnapshotOptions {
  /** Collector host label, e.g. `watch-1`. */
  host: string;
  aliases?: HostAliases;
  /** Heartbeats to carry (normally `BeatBuffer.take`). Defaults to none. */
  beats?: readonly Beat[];
  reachable?: boolean;
  error?: string;
  /** Important beats per monitor (newest kept). */
  importantPerMonitor?: number;
}

/** Kuma sets `url` to `https://` on monitors that do not use it; treat that as no URL. */
const PLACEHOLDER_URL = /^[a-z]+:\/\/\/?$/i;
const HTTP_TYPES = new Set([
  "http",
  "keyword",
  "json-query",
  "real-browser",
  "grpc-keyword",
  "websocket-upgrade",
]);
const VERSION = /^[0-9A-Za-z.+-]{1,32}$/;
const TYPE = /^[a-z0-9-]{1,32}$/;

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/** Sanitized display text, or null when empty. */
function display(s: string | null, max: number, aliases: HostAliases): string | null {
  if (s === null) return null;
  const out = clip(sanitizeText(s, aliases).trim(), max);
  return out.length > 0 ? out : null;
}

export function toKumaMonitor(m: MonitorConfig, aliases: HostAliases): KumaMonitor {
  const isHttp = HTTP_TYPES.has(m.type);
  const url = m.url && !PLACEHOLDER_URL.test(m.url) ? stripUrlCredentials(m.url) : null;
  const method = isHttp && m.method ? m.method.toUpperCase() : null;
  return {
    id: m.id,
    name: display(m.name, 150, aliases) ?? `monitor ${m.id}`,
    type: TYPE.test(m.type) ? m.type : "unknown",
    url: display(url, INGEST_LIMITS.url, aliases),
    hostname: display(m.hostname, 253, aliases),
    port: m.port,
    method: method && /^[A-Z]{1,10}$/.test(method) ? method : null,
    intervalS: m.intervalS,
    timeoutS: m.timeoutS,
    active: m.active,
  };
}

function toKumaBeat(b: Beat, aliases: HostAliases): KumaBeat {
  return {
    monitorId: b.monitorId,
    ts: b.ts,
    status: b.status,
    pingMs: b.pingMs,
    msg: b.msg === null ? null : clip(sanitizeText(b.msg, aliases), INGEST_LIMITS.kumaMessage),
    ...(b.important ? { important: true } : {}),
  };
}

function toCert(c: CertRaw | null, aliases: HostAliases): CertSummary | null {
  if (!c?.validTo || c.daysRemaining === null) return null;
  const cert: CertSummary = {
    valid: c.valid,
    cn: display(c.cn, 253, aliases),
    issuer: display(c.issuer, 200, aliases),
    validTo: c.validTo,
    daysRemaining: c.daysRemaining,
  };
  return cert;
}

/** Builds the payload (sanitized, not yet validated; see `guardSnapshot`). */
export function buildSnapshot(state: KumaState, now: Date, opts: SnapshotOptions): KumaSnapshot {
  const aliases = opts.aliases ?? new Map();
  const monitors = [...state.monitors.values()]
    .sort((a, b) => a.id - b.id)
    .slice(0, INGEST_LIMITS.monitors)
    .map((m) => toKumaMonitor(m, aliases));
  const ids = new Set(monitors.map((m) => m.id));
  const known = (b: Beat) => ids.has(b.monitorId);

  const perMonitor = opts.importantPerMonitor ?? 20;
  const important = [...state.important.entries()]
    .filter(([id]) => ids.has(id))
    .flatMap(([, list]) => list.slice(-perMonitor))
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, INGEST_LIMITS.importantHeartbeats)
    .reverse();

  const uptime: KumaSnapshot["uptime"] = {};
  const avgPing: KumaSnapshot["avgPing"] = {};
  const certInfo: KumaSnapshot["certInfo"] = {};
  for (const { id } of monitors) {
    const k = String(id);
    uptime[k] = { h24: state.uptime24.get(id) ?? null, d30: state.uptime720.get(id) ?? null };
    avgPing[k] = state.avgPing.get(id) ?? null;
    if (state.cert.has(id)) certInfo[k] = toCert(state.cert.get(id) ?? null, aliases);
  }

  const { info } = state;
  const tz = info.timezone
    ? `${info.timezone}${info.timezoneOffset ? ` (${info.timezoneOffset})` : ""}`
    : null;
  const error = opts.error ? display(opts.error, 500, aliases) : null;

  return {
    v: 1,
    generatedAt: now.toISOString(),
    host: opts.host,
    reachable: opts.reachable ?? true,
    ...(error ? { error } : {}),
    kuma: {
      version: info.version && VERSION.test(info.version) ? info.version : null,
      latestVersion: info.latestVersion && VERSION.test(info.latestVersion) ? info.latestVersion : null,
      dbSizeBytes: info.dbSizeBytes,
      timezone: display(tz, 64, aliases),
    },
    monitors,
    heartbeatsSince: (opts.beats ?? [])
      .filter(known)
      .slice(0, INGEST_LIMITS.heartbeats)
      .map((b) => toKumaBeat(b, aliases)),
    importantHeartbeats: important.map((b) => toKumaBeat(b, aliases)),
    uptime,
    avgPing,
    certInfo,
  };
}

export type GuardResult =
  | { ok: true; snapshot: KumaSnapshot }
  | { ok: false; literalPaths: string[]; schemaIssues: string[] };

/**
 * The last gate before a snapshot leaves the process: no forbidden literal anywhere, and the shared
 * schema accepts it. Failures carry field paths and schema messages only, never values.
 */
export function guardSnapshot(snap: unknown): GuardResult {
  const literalPaths = findLiteralPaths(snap);
  const parsed = KumaSnapshot.safeParse(snap);
  const schemaIssues = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join(".") || "$"}: ${i.code}`);
  if (literalPaths.length > 0 || !parsed.success) return { ok: false, literalPaths, schemaIssues };
  return { ok: true, snapshot: parsed.data };
}
