/**
 * Kuma adapter: a collector `KumaSnapshot` -> `ModelDelta` (pure).
 *
 * - Monitors become Service rows `kuma:<monitorId>` with a display target (host + path for HTTP checks,
 *   `host:port` for port checks, the host for ping), method and timeout, uptime ratios, 24 h average ping
 *   and the cert summary. Status and latency come from the newest beat in this snapshot, else the previous
 *   row; per-monitor maps that omit a monitor keep the previous value.
 * - Heartbeats from `heartbeatsSince` and `importantHeartbeats`, de-duplicated on (monitor, ts); messages
 *   are raw Kuma text and go through `scrubForbiddenLiterals`.
 * - Kuma metadata becomes facts in group `kuma`.
 *
 * A display value that is not safe (after the collector mapped addresses to hostnames) rejects the whole
 * snapshot with the offending field paths.
 */
import {
  containsForbiddenLiteral,
  type Fact,
  FactValue,
  type Heartbeat,
  Service,
  type ServiceKind,
  ShortMessage,
  type SourceId,
  scrubForbiddenLiterals,
  serviceId,
} from "@/shared/model";
import {
  type KumaBeat,
  type KumaMonitor,
  type KumaSnapshot,
  kumaStatusToServiceStatus,
  type ModelDelta,
} from "@/shared/schemas";
import { issue, type PayloadIssue, PayloadRejected } from "../ingest/issues";
import { type AdapterContext, byTs, previousById, seenAt } from "./common";

/** Kuma facts stay current for 5 collector intervals. */
export const KUMA_FACT_FRESH_S = 300;

const KIND_BY_TYPE: Readonly<Record<string, ServiceKind>> = {
  http: "http",
  "real-browser": "http",
  keyword: "keyword",
  "json-query": "keyword",
  "grpc-keyword": "keyword",
  port: "port",
  ping: "ping",
  push: "push",
};

export function kumaKind(m: Pick<KumaMonitor, "type" | "url" | "hostname" | "port">): ServiceKind {
  const known = KIND_BY_TYPE[m.type];
  if (known) return known;
  if (m.hostname && m.port) return "port";
  if (m.url) return "http";
  if (m.hostname) return "ping";
  return "push";
}

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
type Method = (typeof METHODS)[number];
const isMethod = (m: string | null): m is Method => !!m && (METHODS as readonly string[]).includes(m);

/** The display target and the payload field it came from (for error paths). */
export function kumaTarget(
  m: KumaMonitor,
  kind: ServiceKind,
): { value: string | null; field: "url" | "hostname" | null } | { error: "url" } {
  if (kind === "push") return { value: null, field: null };
  if ((kind === "http" || kind === "keyword") && m.url) {
    let u: URL;
    try {
      u = new URL(m.url);
    } catch {
      return { error: "url" };
    }
    // Host (with a non-default port) + path; scheme, credentials, query and fragment are dropped.
    return { value: `${u.host}${u.pathname}`, field: "url" };
  }
  if (m.hostname) {
    return { value: kind === "port" && m.port ? `${m.hostname}:${m.port}` : m.hostname, field: "hostname" };
  }
  return { value: null, field: null };
}

/** Kuma text -> a display-safe short message, or null. Truncates before and after scrubbing. */
export function kumaMessage(msg: string | null): string | null {
  if (!msg) return null;
  let out = msg.trim();
  for (let i = 0; i < 3; i++) {
    out = scrubForbiddenLiterals(out.slice(0, 200)).trim();
    if (out.length <= 200 && !containsForbiddenLiteral(out)) break;
  }
  return out && ShortMessage.safeParse(out).success ? out : null;
}

const has = (rec: Record<string, unknown>, id: number) => Object.hasOwn(rec, String(id));

export function normalizeKuma(
  snap: KumaSnapshot,
  source: SourceId,
  site: string,
  now: Date,
  ctx?: AdapterContext,
): ModelDelta {
  const prev = previousById(ctx);
  const problems: PayloadIssue[] = [];
  const important = new Set(snap.importantHeartbeats.map((b) => `${b.monitorId}|${Date.parse(b.ts)}`));

  // Beats, de-duplicated and oldest first.
  const beatMap = new Map<string, KumaBeat>();
  for (const b of [...snap.heartbeatsSince, ...snap.importantHeartbeats]) {
    const k = `${b.monitorId}|${Date.parse(b.ts)}`;
    if (!beatMap.has(k)) beatMap.set(k, b);
  }
  const beats = [...beatMap.entries()].map(([k, b]) => ({ k, b })).sort((x, y) => byTs(x.b, y.b));
  const newest = new Map<number, KumaBeat>();
  for (const { b } of beats) newest.set(b.monitorId, b);

  const services: Service[] = [];
  for (const [i, m] of snap.monitors.entries()) {
    const id = serviceId("kuma", m.id);
    const before = prev.get(id);
    const kind = kumaKind(m);
    const target = kumaTarget(m, kind);
    if ("error" in target) {
      problems.push(issue(["monitors", i, "url"], "URL does not parse"));
      continue;
    }
    const last = newest.get(m.id);
    const cert = has(snap.certInfo, m.id) ? snap.certInfo[String(m.id)] : before?.cert;
    const row = {
      id,
      site,
      source,
      externalId: String(m.id),
      name: m.name,
      kind,
      targetDisplay: target.value,
      intervalS: m.intervalS,
      ...((kind === "http" || kind === "keyword") && isMethod(m.method) ? { method: m.method } : {}),
      ...(m.timeoutS && m.timeoutS > 0 ? { timeoutS: m.timeoutS } : {}),
      status: !m.active
        ? "paused"
        : last
          ? kumaStatusToServiceStatus(last.status)
          : (before?.status ?? "unknown"),
      latencyMs: last ? last.pingMs : (before?.latencyMs ?? null),
      avgLatencyMs: has(snap.avgPing, m.id)
        ? (snap.avgPing[String(m.id)] ?? null)
        : (before?.avgLatencyMs ?? null),
      uptime24h: has(snap.uptime, m.id) ? snap.uptime[String(m.id)]!.h24 : (before?.uptime24h ?? null),
      uptime30d: has(snap.uptime, m.id) ? snap.uptime[String(m.id)]!.d30 : (before?.uptime30d ?? null),
      ...(cert ? { cert } : {}),
    };
    const parsed = Service.safeParse(row);
    if (!parsed.success) {
      for (const iss of parsed.error.issues) {
        const field = iss.path[0];
        const at =
          field === "targetDisplay"
            ? ["monitors", i, target.field ?? "hostname"]
            : field === "name"
              ? ["monitors", i, "name"]
              : ["monitors", i];
        problems.push(issue(at, field === "targetDisplay" ? "Target is not display-safe" : iss.message));
      }
      continue;
    }
    services.push(parsed.data);
  }
  if (problems.length) throw new PayloadRejected(problems);

  const heartbeats: Heartbeat[] = beats.map(({ k, b }) => ({
    site,
    serviceId: serviceId("kuma", b.monitorId),
    ts: b.ts,
    status: kumaStatusToServiceStatus(b.status),
    latencyMs: b.pingMs,
    message: kumaMessage(b.msg),
    important: b.important === true || important.has(k),
  }));

  const facts: Fact[] = [];
  const fact = (key: string, raw: string | number | boolean | null, unit: string | null = null) => {
    if (raw === null) return;
    const value = FactValue.safeParse(
      typeof raw === "number"
        ? { type: "number", value: raw }
        : typeof raw === "boolean"
          ? { type: "boolean", value: raw }
          : { type: "string", value: raw },
    );
    if (!value.success) return;
    const outdated = key === "latestVersion" && snap.kuma.version !== null && raw !== snap.kuma.version;
    facts.push({
      site,
      source,
      group: "kuma",
      key,
      value: value.data,
      unit,
      severity: outdated ? "info" : "ok",
      observedAt: snap.generatedAt,
      freshForS: KUMA_FACT_FRESH_S,
    });
  };
  fact("host", snap.host);
  fact("reachable", snap.reachable);
  fact("version", snap.kuma.version);
  fact("latestVersion", snap.kuma.latestVersion);
  fact(
    "dbSize",
    snap.kuma.dbSizeBytes === null ? null : Math.round((snap.kuma.dbSizeBytes / 1024 / 1024) * 10) / 10,
    "MB",
  );
  fact("timezone", snap.kuma.timezone);

  return {
    site,
    generatedAt: snap.generatedAt,
    source: {
      sourceId: source,
      seenAt: seenAt(snap.generatedAt, now),
      ok: snap.reachable,
      error: snap.reachable ? null : (snap.error ?? "Kuma unreachable"),
    },
    services,
    heartbeats,
    facts,
  };
}

export { normalizeKuma as normalize };
