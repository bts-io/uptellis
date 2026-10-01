import { describe, expect, it } from "vitest";
import {
  Fact,
  FactValue,
  factValueFrom,
  Heartbeat,
  Incident,
  Service,
  type ServiceStatus,
  Site,
  Source,
  serviceId,
  sourceAgeS,
  sourceFreshness,
} from "@/shared/model";

const DOC4 = [192, 0, 2, 10].join(".");

const forgejoHealth: Service = {
  id: "kuma:1",
  site: "demo",
  source: "kuma:watch-1",
  externalId: "1",
  name: "API health",
  kind: "http",
  targetDisplay: "example.com/api/healthz",
  intervalS: 30,
  status: "up",
  latencyMs: 388,
  avgLatencyMs: 402,
  uptime24h: 1,
  uptime30d: 0.9997,
  cert: {
    valid: true,
    cn: "example.com",
    issuer: "Example CA",
    validTo: "2026-12-10T08:12:00Z",
    daysRemaining: 74,
  },
};

const primaryPostgres: Service = {
  id: "kuma:3",
  site: "demo",
  source: "kuma:watch-1",
  externalId: "3",
  name: "Primary Postgres",
  kind: "port",
  targetDisplay: "app-1:5432",
  intervalS: 60,
  status: "up",
  latencyMs: 131,
  avgLatencyMs: 129,
  uptime24h: 1,
  uptime30d: 1,
};

describe("Site", () => {
  it("accepts the demo site", () => {
    expect(
      Site.parse({
        slug: "demo",
        name: "Acme Cloud",
        hostnames: ["status.example.com"],
        configVersion: 1,
      }).slug,
    ).toBe("demo");
  });
  it("rejects an address as hostname and a bad slug", () => {
    const base = { slug: "demo", name: "Acme", hostnames: ["status.example.com"], configVersion: 1 };
    expect(Site.safeParse({ ...base, hostnames: [DOC4] }).success).toBe(false);
    expect(Site.safeParse({ ...base, slug: "B" }).success).toBe(false);
    expect(Site.safeParse({ ...base, hostnames: ["localhost"] }).success).toBe(false);
  });
  it("accepts a site with no hostnames (served only as the default or only site)", () => {
    const base = { slug: "acme", name: "Acme", hostnames: [], configVersion: 1 };
    expect(Site.safeParse(base).success).toBe(true);
  });
});

describe("Service", () => {
  it("accepts sample-derived services", () => {
    expect(Service.parse(forgejoHealth)).toEqual(forgejoHealth);
    expect(Service.parse(primaryPostgres)).toEqual(primaryPostgres);
  });
  it("builds ids with serviceId()", () => {
    expect(serviceId("kuma", 9)).toBe("kuma:9");
  });
  it("rejects an address literal in targetDisplay", () => {
    expect(Service.safeParse({ ...primaryPostgres, targetDisplay: `${DOC4}:5432` }).success).toBe(false);
  });
  it("rejects an unknown status", () => {
    expect(Service.safeParse({ ...primaryPostgres, status: "green" }).success).toBe(false);
  });
  it("rejects an id that does not match source kind and externalId", () => {
    expect(Service.safeParse({ ...primaryPostgres, id: "kuma:4" }).success).toBe(false);
    expect(Service.safeParse({ ...primaryPostgres, source: "probe:edge" }).success).toBe(false);
  });
  it("rejects uptime outside 0..1 (ratios, not percent)", () => {
    expect(Service.safeParse({ ...primaryPostgres, uptime30d: 99.97 }).success).toBe(false);
  });
  it("covers every status", () => {
    const all: ServiceStatus[] = ["up", "down", "degraded", "pending", "maintenance", "paused", "unknown"];
    for (const status of all) expect(Service.safeParse({ ...primaryPostgres, status }).success).toBe(true);
  });
});

describe("Heartbeat", () => {
  const beat: Heartbeat = {
    site: "demo",
    serviceId: "kuma:1",
    ts: "2026-09-27T23:57:41Z",
    status: "up",
    latencyMs: 371,
    message: "200 - OK",
    important: false,
  };
  it("accepts a sample beat", () => {
    expect(Heartbeat.parse(beat)).toEqual(beat);
  });
  it("rejects a non-ISO timestamp, an address in the message and an unknown status", () => {
    expect(Heartbeat.safeParse({ ...beat, ts: "23:57:41" }).success).toBe(false);
    expect(Heartbeat.safeParse({ ...beat, ts: "2026-09-27 23:57:41" }).success).toBe(false);
    expect(Heartbeat.safeParse({ ...beat, message: `ECONNREFUSED ${DOC4}:5432` }).success).toBe(false);
    expect(Heartbeat.safeParse({ ...beat, status: 1 }).success).toBe(false);
  });
});

describe("Incident", () => {
  const down: Incident = {
    id: "down:kuma:5:2026-09-15T04:10:00Z",
    site: "demo",
    kind: "down",
    serviceId: "kuma:5",
    sourceId: null,
    startedAt: "2026-09-15T04:10:00Z",
    endedAt: "2026-09-15T04:12:00Z",
    title: "Replica Postgres down",
    notes: null,
  };
  it("accepts down and stale incidents", () => {
    expect(Incident.parse(down).kind).toBe("down");
    expect(
      Incident.parse({
        ...down,
        id: "stale:kuma:watch-1:2026-09-27T23:00:00Z",
        kind: "stale",
        serviceId: null,
        sourceId: "kuma:watch-1",
        startedAt: "2026-09-27T23:00:00Z",
        endedAt: null,
        title: "Kuma collector silent",
      }).endedAt,
    ).toBeNull();
  });
  it("rejects missing refs, reversed times and unsafe titles", () => {
    expect(Incident.safeParse({ ...down, serviceId: null }).success).toBe(false);
    expect(Incident.safeParse({ ...down, kind: "stale" }).success).toBe(false);
    expect(Incident.safeParse({ ...down, endedAt: "2026-09-15T04:00:00Z" }).success).toBe(false);
    expect(Incident.safeParse({ ...down, title: `${DOC4} down` }).success).toBe(false);
    expect(Incident.safeParse({ ...down, kind: "outage" }).success).toBe(false);
  });
});

describe("Fact", () => {
  const lag: Fact = {
    site: "demo",
    source: "facts:app-1",
    group: "replication",
    key: "lagSeconds",
    value: { type: "number", value: 0 },
    unit: "s",
    severity: "ok",
    observedAt: "2026-09-27T23:45:00Z",
    freshForS: 900,
  };
  it("accepts every value type", () => {
    expect(Fact.parse(lag)).toEqual(lag);
    expect(
      Fact.parse({ ...lag, key: "state", value: { type: "string", value: "streaming" }, unit: null }).key,
    ).toBe("state");
    expect(
      Fact.parse({ ...lag, group: "watchdog", key: "reachable", value: { type: "boolean", value: true } }),
    ).toBeTruthy();
    expect(
      Fact.parse({
        ...lag,
        group: "backup",
        key: "lastAt",
        value: { type: "timestamp", value: "2026-09-26T22:43:48Z" },
      }),
    ).toBeTruthy();
  });
  it("rejects mistyped and unsafe values, bad severity", () => {
    expect(Fact.safeParse({ ...lag, value: { type: "number", value: "0" } }).success).toBe(false);
    expect(Fact.safeParse({ ...lag, value: { type: "timestamp", value: "yesterday" } }).success).toBe(false);
    expect(Fact.safeParse({ ...lag, value: { type: "string", value: DOC4 } }).success).toBe(false);
    expect(Fact.safeParse({ ...lag, severity: "error" }).success).toBe(false);
    expect(Fact.safeParse({ ...lag, freshForS: 0 }).success).toBe(false);
  });
  it("factValueFrom infers and honours hints", () => {
    expect(factValueFrom(16)).toEqual({ type: "number", value: 16 });
    expect(factValueFrom(true)).toEqual({ type: "boolean", value: true });
    expect(factValueFrom("16.0.5")).toEqual({ type: "string", value: "16.0.5" });
    expect(factValueFrom("2026-09-26T22:43:48Z", "timestamp")?.type).toBe("timestamp");
    expect(factValueFrom("2026-09-26T22:43:48Z")?.type).toBe("string");
    expect(factValueFrom("soon", "timestamp")).toBeNull();
    expect(factValueFrom(DOC4)).toBeNull();
    expect(FactValue.safeParse({ type: "bigint", value: 1 }).success).toBe(false);
  });
});

describe("Source and sourceFreshness", () => {
  const src: Source = {
    id: "kuma:watch-1",
    site: "demo",
    kind: "kuma",
    expectedIntervalS: 60,
    lastSeenAt: "2026-09-27T23:58:00Z",
    lastOkAt: "2026-09-27T23:58:00Z",
  };
  const seen = Date.parse(src.lastSeenAt!);
  const at = (s: number) => seen + s * 1000;

  it("parses and checks kind against id", () => {
    expect(Source.parse(src)).toEqual(src);
    expect(Source.safeParse({ ...src, kind: "facts" }).success).toBe(false);
    expect(Source.safeParse({ ...src, kind: "rss" }).success).toBe(false);
  });
  it("is empty when never seen", () => {
    expect(sourceFreshness({ ...src, lastSeenAt: null }, at(0))).toBe("empty");
    expect(sourceAgeS({ lastSeenAt: null }, at(0))).toBeNull();
  });
  it("fresh below 2x the interval", () => {
    expect(sourceFreshness(src, at(0))).toBe("fresh");
    expect(sourceFreshness(src, at(119.999))).toBe("fresh");
  });
  it("aging from 2x up to and including 5x", () => {
    expect(sourceFreshness(src, at(120))).toBe("aging");
    expect(sourceFreshness(src, at(300))).toBe("aging");
  });
  it("stale beyond 5x", () => {
    expect(sourceFreshness(src, at(300.001))).toBe("stale");
    expect(sourceFreshness(src, new Date(at(3600)))).toBe("stale");
  });
  it("treats a future lastSeenAt (clock skew) as fresh", () => {
    expect(sourceFreshness(src, at(-30))).toBe("fresh");
    expect(sourceAgeS(src, at(-30))).toBe(0);
  });
  it("scales with the interval (facts at 900 s)", () => {
    const facts = { ...src, expectedIntervalS: 900 };
    expect(sourceFreshness(facts, at(1799))).toBe("fresh");
    expect(sourceFreshness(facts, at(1800))).toBe("aging");
    expect(sourceFreshness(facts, at(4501))).toBe("stale");
  });
});

describe("Phase 1 model additions", () => {
  it("builds incident ids from subject and start", async () => {
    const { incidentId, Incident } = await import("@/shared/model");
    const id = incidentId("kuma:5", "2026-09-27T23:52:00Z");
    expect(id).toBe("kuma:5:2026-09-27T23:52:00Z");
    expect(Incident.shape.id.safeParse(id).success).toBe(true);
  });
});
