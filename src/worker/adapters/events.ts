/**
 * Generic events adapter: an `EventsPayload` batch -> `ModelDelta` (pure). Services are declared by the
 * producer (`<source kind>:<externalId>`); heartbeats must name a service declared in the same batch or
 * already known for this source. A heartbeat is `important` when its status differs from the one before
 * it (the previous row, then the batch in time order), which is what drives incident derivation.
 */
import {
  type Heartbeat,
  Service,
  type ServiceStatus,
  type SourceId,
  serviceId,
  sourceKindOf,
} from "@/shared/model";
import type { EventHeartbeat, EventService, EventsPayload, ModelDelta } from "@/shared/schemas";
import { issue, type PayloadIssue, PayloadRejected } from "../ingest/issues";
import { type AdapterContext, byTs, previousById, seenAt } from "./common";
import { toFact } from "./facts";

export function normalizeEvents(
  p: EventsPayload,
  source: SourceId,
  site: string,
  now: Date,
  ctx?: AdapterContext,
): ModelDelta {
  const kind = sourceKindOf(source);
  const prev = previousById(ctx);
  const problems: PayloadIssue[] = [];

  const declared = new Map<string, { s: EventService; i: number }>();
  for (const [i, s] of (p.services ?? []).entries()) {
    if (declared.has(s.externalId)) problems.push(issue(["services", i, "externalId"], "Duplicate service"));
    const owner = prev.get(serviceId(kind, s.externalId))?.source;
    if (owner && owner !== source) {
      problems.push(issue(["services", i, "externalId"], "Service belongs to another source"));
    }
    declared.set(s.externalId, { s, i });
  }

  const beatsByService = new Map<string, EventHeartbeat[]>();
  for (const [i, b] of (p.heartbeats ?? []).entries()) {
    const known = declared.has(b.externalId) || prev.get(serviceId(kind, b.externalId))?.source === source;
    if (!known) {
      problems.push(issue(["heartbeats", i, "externalId"], "Unknown service: declare it in services first"));
      continue;
    }
    const list = beatsByService.get(b.externalId) ?? [];
    list.push(b);
    beatsByService.set(b.externalId, list);
  }
  if (problems.length) throw new PayloadRejected(problems);

  const heartbeats: Heartbeat[] = [];
  const services: Service[] = [];
  const touched = new Set([...declared.keys(), ...beatsByService.keys()]);
  for (const ext of touched) {
    const id = serviceId(kind, ext);
    const before = prev.get(id);
    const decl = declared.get(ext);
    const beats = (beatsByService.get(ext) ?? []).sort(byTs);

    let running: ServiceStatus | undefined = before?.status;
    for (const b of beats) {
      heartbeats.push({
        site,
        serviceId: id,
        ts: b.ts,
        status: b.status,
        latencyMs: b.latencyMs ?? null,
        message: b.message ?? null,
        important: b.status !== running,
      });
      running = b.status;
    }
    const last = beats.at(-1);
    const row = {
      id,
      site,
      source,
      externalId: ext,
      name: decl?.s.name ?? before!.name,
      kind: decl?.s.kind ?? before!.kind,
      targetDisplay: decl ? (decl.s.targetDisplay ?? null) : (before?.targetDisplay ?? null),
      intervalS: decl?.s.intervalS ?? before?.intervalS ?? null,
      status: last?.status ?? before?.status ?? "unknown",
      latencyMs: last ? (last.latencyMs ?? null) : (before?.latencyMs ?? null),
      avgLatencyMs: before?.avgLatencyMs ?? null,
      uptime24h: before?.uptime24h ?? null,
      uptime30d: before?.uptime30d ?? null,
    };
    const parsed = Service.safeParse(row);
    if (!parsed.success) {
      problems.push(issue(decl ? ["services", decl.i] : ["heartbeats"], "Service row is not valid"));
      continue;
    }
    services.push(parsed.data);
  }
  if (problems.length) throw new PayloadRejected(problems);

  const facts = (p.facts ?? []).map((f, i) => toFact(f, source, site, p.generatedAt, ["facts", i]));

  return {
    site,
    generatedAt: p.generatedAt,
    source: { sourceId: source, seenAt: seenAt(p.generatedAt, now), ok: true, error: null },
    services,
    heartbeats: heartbeats.sort(byTs),
    facts,
  };
}

export { normalizeEvents as normalize };
