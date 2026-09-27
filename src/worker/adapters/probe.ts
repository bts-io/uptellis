/**
 * Probe adapter: the results of one probe run -> `ModelDelta` (pure). Each configured probe is a Service
 * `probe:<id>` of kind `http` whose target is the URL's host + path; each result is one heartbeat at the
 * run's scheduled time, `important` when its status differs from the service's previous one.
 */
import type { ProbeConfig } from "@/shared/config";
import { type Heartbeat, Service, type SourceId, serviceId } from "@/shared/model";
import type { ModelDelta } from "@/shared/schemas";
import type { ProbeResult } from "../probes/checker";
import { type AdapterContext, isoSeconds, previousById, seenAt } from "./common";

export interface ProbeCheck {
  probe: ProbeConfig;
  result: ProbeResult;
}

/** Host (with a non-default port) + path; scheme, query and fragment are dropped. */
export const probeTarget = (url: string) => {
  const u = new URL(url);
  return `${u.host}${u.pathname}`;
};

export function normalizeProbes(
  checks: readonly ProbeCheck[],
  source: SourceId,
  site: string,
  scheduledAt: Date,
  now: Date,
  ctx?: AdapterContext,
): ModelDelta {
  const prev = previousById(ctx);
  const ts = isoSeconds(scheduledAt);
  const services: Service[] = [];
  const heartbeats: Heartbeat[] = [];
  for (const { probe, result } of checks) {
    const id = serviceId("probe", probe.id);
    const before = prev.get(id);
    heartbeats.push({
      site,
      serviceId: id,
      ts,
      status: result.status,
      latencyMs: result.latencyMs,
      message: result.message,
      important: result.status !== before?.status,
    });
    services.push(
      Service.parse({
        id,
        site,
        source,
        externalId: probe.id,
        name: probe.name,
        kind: "http",
        targetDisplay: probeTarget(probe.url),
        intervalS: probe.intervalS,
        method: probe.method,
        timeoutS: probe.timeoutS,
        status: result.status,
        latencyMs: result.latencyMs,
        avgLatencyMs: before?.avgLatencyMs ?? null,
        uptime24h: before?.uptime24h ?? null,
        uptime30d: before?.uptime30d ?? null,
      }),
    );
  }
  return {
    site,
    generatedAt: ts,
    source: { sourceId: source, seenAt: seenAt(ts, now), ok: true, error: null },
    services,
    heartbeats,
    facts: [],
  };
}
