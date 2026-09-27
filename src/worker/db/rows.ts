import type { Fact, FactValue, Heartbeat, Incident, Service, Source } from "@/shared/model";
import type { schema } from "./index";
import { toIso, toMs } from "./util";

// Row <-> model mappers. Timestamps are epoch ms in D1 and canonical ISO strings in the model.

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];
type NewRow<T extends { $inferInsert: unknown }> = T["$inferInsert"];

type ServiceRow = Row<typeof schema.services>;
type HeartbeatRow = Row<typeof schema.heartbeats>;
type IncidentRow = Row<typeof schema.incidents>;
type FactRow = Row<typeof schema.facts>;
type SourceRow = Row<typeof schema.sources>;

const isoOrNull = (ms: number | null) => (ms === null ? null : toIso(ms));

export function serviceToRow(s: Service, observedAt: number): NewRow<typeof schema.services> {
  return {
    site: s.site,
    id: s.id,
    source: s.source,
    externalId: s.externalId,
    name: s.name,
    kind: s.kind,
    targetDisplay: s.targetDisplay,
    intervalS: s.intervalS,
    method: s.method ?? null,
    timeoutS: s.timeoutS ?? null,
    status: s.status,
    latencyMs: s.latencyMs,
    avgLatencyMs: s.avgLatencyMs,
    uptime24h: s.uptime24h,
    uptime30d: s.uptime30d,
    cert: s.cert ?? null,
    observedAt,
  };
}

export function rowToService(r: ServiceRow): Service {
  const s: Service = {
    id: r.id,
    site: r.site,
    source: r.source,
    externalId: r.externalId,
    name: r.name,
    kind: r.kind,
    targetDisplay: r.targetDisplay,
    intervalS: r.intervalS,
    status: r.status,
    latencyMs: r.latencyMs,
    avgLatencyMs: r.avgLatencyMs,
    uptime24h: r.uptime24h,
    uptime30d: r.uptime30d,
  };
  if (r.method !== null) s.method = r.method as NonNullable<Service["method"]>;
  if (r.timeoutS !== null) s.timeoutS = r.timeoutS;
  if (r.cert !== null) s.cert = r.cert;
  return s;
}

export function heartbeatToRow(h: Heartbeat): NewRow<typeof schema.heartbeats> {
  return {
    site: h.site,
    serviceId: h.serviceId,
    ts: toMs(h.ts),
    status: h.status,
    latencyMs: h.latencyMs,
    message: h.message,
    important: h.important,
  };
}

export function rowToHeartbeat(r: HeartbeatRow): Heartbeat {
  return {
    site: r.site,
    serviceId: r.serviceId,
    ts: toIso(r.ts),
    status: r.status,
    latencyMs: r.latencyMs,
    message: r.message,
    important: r.important,
  };
}

export function incidentToRow(i: Incident, updatedAt: number): NewRow<typeof schema.incidents> {
  return {
    site: i.site,
    id: i.id,
    kind: i.kind,
    serviceId: i.serviceId,
    sourceId: i.sourceId,
    startedAt: toMs(i.startedAt),
    endedAt: i.endedAt === null ? null : toMs(i.endedAt),
    title: i.title,
    notes: i.notes,
    updatedAt,
  };
}

export function rowToIncident(r: IncidentRow): Incident {
  return {
    id: r.id,
    site: r.site,
    kind: r.kind,
    serviceId: r.serviceId,
    sourceId: r.sourceId,
    startedAt: toIso(r.startedAt),
    endedAt: isoOrNull(r.endedAt),
    title: r.title,
    notes: r.notes,
  };
}

export function factToRow(f: Fact): NewRow<typeof schema.facts> {
  const v = f.value;
  return {
    site: f.site,
    grp: f.group,
    key: f.key,
    source: f.source,
    valueType: v.type,
    valueText: v.type === "string" || v.type === "timestamp" ? v.value : null,
    valueNum: v.type === "number" ? v.value : null,
    valueBool: v.type === "boolean" ? v.value : null,
    unit: f.unit,
    severity: f.severity,
    observedAt: toMs(f.observedAt),
    freshForS: f.freshForS,
  };
}

function rowToFactValue(r: FactRow): FactValue {
  switch (r.valueType) {
    case "number":
      return { type: "number", value: r.valueNum ?? 0 };
    case "boolean":
      return { type: "boolean", value: r.valueBool ?? false };
    case "timestamp":
      return { type: "timestamp", value: r.valueText ?? toIso(0) };
    default:
      return { type: "string", value: r.valueText ?? "" };
  }
}

export function rowToFact(r: FactRow): Fact {
  return {
    site: r.site,
    source: r.source,
    group: r.grp,
    key: r.key,
    value: rowToFactValue(r),
    unit: r.unit,
    severity: r.severity,
    observedAt: toIso(r.observedAt),
    freshForS: r.freshForS,
  };
}

export function rowToSource(
  r: Pick<SourceRow, "site" | "id" | "kind" | "expectedIntervalS" | "lastSeenAt" | "lastOkAt">,
): Source {
  return {
    id: r.id,
    site: r.site,
    kind: r.kind,
    expectedIntervalS: r.expectedIntervalS,
    lastSeenAt: isoOrNull(r.lastSeenAt),
    lastOkAt: isoOrNull(r.lastOkAt),
  };
}
