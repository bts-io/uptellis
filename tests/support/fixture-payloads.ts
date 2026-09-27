/**
 * Builds producer payloads from the scrubbed model fixtures, the inverse of the adapters: a
 * `KumaSnapshot` as the collector would send it, and a `FactsPayload` as status-card.sh would.
 */
import type { z } from "zod";
import type { FactsPayload, KumaSnapshot } from "@/shared/schemas";
import type { FixtureModel } from "../fixtures";

type KumaInput = z.input<typeof KumaSnapshot>;
type FactsInput = z.input<typeof FactsPayload>;

const KUMA_CODE = { down: 0, up: 1, pending: 2, maintenance: 3 } as const;

/** Kuma reports the database size in bytes; the fixture shows MB (1024 * 1024). */
const MB = 1024 * 1024;

export const FIXTURE_TIMEOUT_S = 48;

export function kumaSnapshotFrom(fx: FixtureModel, overrides: Partial<KumaInput> = {}): KumaInput {
  const kumaSource = fx.sources.find((s) => s.kind === "kuma")!;
  const services = fx.services.filter((s) => s.source === kumaSource.id);
  const kf = (key: string) =>
    fx.facts.find((f) => f.source === kumaSource.id && f.group === "kuma" && f.key === key);
  const str = (key: string) => {
    const v = kf(key)?.value;
    return v && v.type === "string" ? v.value : null;
  };
  const num = (key: string) => {
    const v = kf(key)?.value;
    return v && v.type === "number" ? v.value : null;
  };

  const monitors = services.map((s) => {
    const target = s.targetDisplay ?? "";
    const isHttp = s.kind === "http" || s.kind === "keyword";
    const colon = target.lastIndexOf(":");
    return {
      id: Number(s.externalId),
      name: s.name,
      type: s.kind,
      url: isHttp ? `https://${target}` : null,
      hostname: isHttp ? null : s.kind === "port" ? target.slice(0, colon) : target || null,
      port: s.kind === "port" ? Number(target.slice(colon + 1)) : null,
      method: isHttp ? "GET" : null,
      intervalS: s.intervalS ?? 60,
      timeoutS: FIXTURE_TIMEOUT_S,
      active: true,
    };
  });

  const beats = fx.heartbeats
    .filter((h) => services.some((s) => s.id === h.serviceId) && h.status in KUMA_CODE)
    .map((h) => ({
      monitorId: Number(h.serviceId.slice(h.serviceId.indexOf(":") + 1)),
      ts: h.ts,
      status: KUMA_CODE[h.status as keyof typeof KUMA_CODE],
      pingMs: h.latencyMs,
      msg: h.message,
      important: h.important,
    }));

  const byId = <T>(f: (s: (typeof services)[number]) => T) =>
    Object.fromEntries(services.map((s) => [s.externalId, f(s)]));
  const dbMb = num("dbSize");

  return {
    v: 1,
    generatedAt: kumaSource.lastSeenAt!,
    host: str("host") ?? "watch-1",
    reachable: true,
    kuma: {
      version: str("version"),
      latestVersion: str("latestVersion"),
      dbSizeBytes: dbMb === null ? null : Math.round(dbMb * MB),
      timezone: str("timezone"),
    },
    monitors,
    heartbeatsSince: beats,
    importantHeartbeats: beats.filter((b) => b.important),
    uptime: byId((s) => ({ h24: s.uptime24h, d30: s.uptime30d })),
    avgPing: byId((s) => s.avgLatencyMs),
    certInfo: byId((s) => s.cert ?? null),
    ...overrides,
  };
}

export function factsPayloadFrom(fx: FixtureModel, sourceId = "facts:app-1"): FactsInput {
  const source = fx.sources.find((s) => s.id === sourceId)!;
  const facts = fx.facts.filter((f) => f.source === sourceId);
  const groups = [...new Set(facts.map((f) => f.group))];
  return {
    v: 1,
    generatedAt: source.lastSeenAt!,
    producer: "app-1",
    groups: groups.map((group) => ({
      group,
      facts: facts
        .filter((f) => f.group === group)
        .map((f) => ({
          key: f.key,
          value: f.value.value,
          ...(f.value.type === "timestamp" ? { type: "timestamp" as const } : {}),
          ...(f.unit ? { unit: f.unit } : {}),
          ...(f.severity ? { severity: f.severity } : {}),
          freshForS: f.freshForS,
          ...(f.observedAt !== source.lastSeenAt ? { observedAt: f.observedAt } : {}),
        })),
    })),
  };
}
