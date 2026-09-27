import type { Heartbeat, Service } from "@/shared/model";
import type { ModelDelta } from "@/shared/schemas";
import { type FixtureModel, type FixtureName, loadFixture } from "../fixtures";

/** A fixture moved to its own site slug, so every test writes rows no other test reads. */
export function fixtureFor(name: FixtureName, site: string): FixtureModel {
  const f = loadFixture(name);
  const move = <T extends { site: string }>(rows: T[]) => rows.map((r) => ({ ...r, site }));
  return {
    ...f,
    site: { ...f.site, slug: site },
    sources: move(f.sources),
    services: move(f.services),
    heartbeats: move(f.heartbeats),
    incidents: move(f.incidents),
    facts: move(f.facts),
  };
}

/** The delta a Kuma ingest of this fixture would produce (all services, heartbeats and facts). */
export function deltaOf(f: FixtureModel, generatedAt = f.now): ModelDelta {
  return {
    site: f.site.slug,
    generatedAt,
    source: { sourceId: "kuma:watch-1", seenAt: generatedAt, ok: true, error: null },
    services: f.services,
    heartbeats: f.heartbeats,
    facts: f.facts,
  };
}

export function beat(
  site: string,
  serviceId: string,
  ts: string,
  status: Heartbeat["status"],
  latencyMs: number | null = null,
): Heartbeat {
  return { site, serviceId, ts, status, latencyMs, message: null, important: false };
}

export function service(
  site: string,
  externalId: string,
  status: Service["status"],
  name = `Service ${externalId}`,
): Service {
  return {
    id: `kuma:${externalId}`,
    site,
    source: "kuma:watch-1",
    externalId,
    name,
    kind: "http",
    targetDisplay: "example.com/health",
    intervalS: 60,
    status,
    latencyMs: null,
    avgLatencyMs: null,
    uptime24h: null,
    uptime30d: null,
  };
}

export function delta(
  site: string,
  generatedAt: string,
  parts: Partial<Pick<ModelDelta, "services" | "heartbeats" | "facts">>,
): ModelDelta {
  return {
    site,
    generatedAt,
    source: { sourceId: "kuma:watch-1", seenAt: generatedAt, ok: true, error: null },
    services: parts.services ?? [],
    heartbeats: parts.heartbeats ?? [],
    facts: parts.facts ?? [],
  };
}
