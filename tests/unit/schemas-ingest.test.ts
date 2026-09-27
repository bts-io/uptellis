import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  EventsPayload,
  FactsPayload,
  INGEST_LIMITS,
  KumaSnapshot,
  kumaStatusToServiceStatus,
  ModelDelta,
} from "@/shared/schemas";

const DOC4 = [192, 0, 2, 10].join(".");

/** Derived from mockups/sample-data.json with addresses mapped to hostnames by the collector. */
const snapshot: z.input<typeof KumaSnapshot> = {
  v: 1,
  generatedAt: "2026-09-27T23:58:00Z",
  host: "watch-1",
  reachable: true,
  kuma: {
    version: "2.5.5",
    latestVersion: "2.5.5",
    dbSizeBytes: 43_200_000,
    timezone: "Asia/Tokyo (+09:00)",
  },
  monitors: [
    {
      id: 1,
      name: "API health",
      type: "http",
      url: "https://example.com/api/healthz",
      hostname: null,
      port: null,
      method: "GET",
      intervalS: 30,
      timeoutS: 48,
      active: true,
    },
    {
      id: 3,
      name: "Primary Postgres",
      type: "port",
      url: null,
      hostname: "app-1",
      port: 5432,
      method: null,
      intervalS: 60,
      timeoutS: 48,
      active: true,
    },
    {
      id: 8,
      name: "Runner ping",
      type: "ping",
      url: null,
      hostname: "runner-1",
      port: null,
      method: null,
      intervalS: 60,
      timeoutS: 48,
      active: true,
    },
  ],
  heartbeatsSince: [
    { monitorId: 1, ts: "2026-09-27T23:57:41Z", status: 1, pingMs: 371, msg: "200 - OK" },
    { monitorId: 3, ts: "2026-09-27T23:57:05Z", status: 1, pingMs: 131, msg: "open" },
    { monitorId: 8, ts: "2026-09-27T23:57:30Z", status: 1, pingMs: 1, msg: "1 ms" },
  ],
  importantHeartbeats: [
    { monitorId: 3, ts: "2026-09-15T04:12:00Z", status: 1, pingMs: 140, msg: "open", important: true },
    {
      monitorId: 3,
      ts: "2026-09-15T04:10:00Z",
      status: 0,
      pingMs: null,
      msg: `connect ECONNREFUSED ${DOC4}:5432`,
      important: true,
    },
  ],
  uptime: { "1": { h24: 1, d30: 0.9997 }, "3": { h24: 1, d30: 1 }, "8": { h24: 1, d30: 1 } },
  avgPing: { "1": 402, "3": 129, "8": 1 },
  certInfo: {
    "1": {
      valid: true,
      cn: "example.com",
      issuer: "Example CA",
      validTo: "2026-12-10T08:12:00Z",
      daysRemaining: 74,
    },
    "3": null,
  },
};

describe("KumaSnapshot", () => {
  it("accepts the sample-derived snapshot (raw msg may carry an address; the adapter scrubs it)", () => {
    const parsed = KumaSnapshot.parse(snapshot);
    expect(parsed.monitors).toHaveLength(3);
    expect(parsed.certInfo["1"]?.daysRemaining).toBe(74);
  });
  it("accepts an unreachable snapshot", () => {
    const down = {
      ...snapshot,
      reachable: false,
      error: "login failed",
      kuma: { version: null, latestVersion: null, dbSizeBytes: null, timezone: null },
      heartbeatsSince: [],
      importantHeartbeats: [],
    };
    expect(KumaSnapshot.safeParse(down).success).toBe(true);
  });
  it("maps Kuma status codes", () => {
    expect([0, 1, 2, 3].map((c) => kumaStatusToServiceStatus(c as 0 | 1 | 2 | 3))).toEqual([
      "down",
      "up",
      "pending",
      "maintenance",
    ]);
  });
  it("rejects address literals in display fields", () => {
    const bad = structuredClone(snapshot);
    bad.monitors[1]!.hostname = DOC4;
    expect(KumaSnapshot.safeParse(bad).success).toBe(false);
    const badUrl = structuredClone(snapshot);
    badUrl.monitors[0]!.url = `http://${DOC4}/`;
    expect(KumaSnapshot.safeParse(badUrl).success).toBe(false);
  });
  it("rejects unknown status codes and monitor refs", () => {
    const bad = structuredClone(snapshot);
    (bad.heartbeatsSince[0] as { status: number }).status = 4;
    expect(KumaSnapshot.safeParse(bad).success).toBe(false);
    const orphan = structuredClone(snapshot);
    orphan.heartbeatsSince.push({
      monitorId: 99,
      ts: "2026-09-27T23:57:41Z",
      status: 1,
      pingMs: 1,
      msg: null,
    });
    expect(KumaSnapshot.safeParse(orphan).success).toBe(false);
    const orphanMap = structuredClone(snapshot) as { avgPing: Record<string, number> };
    orphanMap.avgPing["42"] = 1;
    expect(KumaSnapshot.safeParse(orphanMap).success).toBe(false);
  });
  it("rejects too-long arrays and strings", () => {
    const beats = Array.from({ length: INGEST_LIMITS.heartbeats + 1 }, (_, i) => ({
      monitorId: 1,
      ts: new Date(Date.UTC(2026, 8, 27) + i * 1000).toISOString(),
      status: 1,
      pingMs: 1,
      msg: null,
    }));
    expect(KumaSnapshot.safeParse({ ...snapshot, heartbeatsSince: beats }).success).toBe(false);
    const longMsg = structuredClone(snapshot);
    longMsg.heartbeatsSince[0]!.msg = "x".repeat(INGEST_LIMITS.kumaMessage + 1);
    expect(KumaSnapshot.safeParse(longMsg).success).toBe(false);
  });
  it("rejects duplicate monitors, a wrong version and a non-ISO generatedAt", () => {
    expect(
      KumaSnapshot.safeParse({ ...snapshot, monitors: [...snapshot.monitors, snapshot.monitors[0]] }).success,
    ).toBe(false);
    expect(KumaSnapshot.safeParse({ ...snapshot, v: 2 }).success).toBe(false);
    expect(KumaSnapshot.safeParse({ ...snapshot, generatedAt: "2026-09-27 23:58" }).success).toBe(false);
  });
});

const facts: z.input<typeof FactsPayload> = {
  v: 1,
  generatedAt: "2026-09-27T23:45:00Z",
  producer: "app-1",
  groups: [
    {
      group: "replication",
      facts: [
        { key: "state", value: "streaming", severity: "ok", freshForS: 900 },
        { key: "lagSeconds", value: 0, unit: "s", severity: "ok", freshForS: 900 },
      ],
    },
    { group: "fence", facts: [{ key: "decision", value: "serve", freshForS: 900 }] },
    {
      group: "backup",
      facts: [
        { key: "lastAt", value: "2026-09-26T22:43:48Z", type: "timestamp", freshForS: 93_600 },
        { key: "sizeMiB", value: 73.7, unit: "MiB", freshForS: 93_600 },
      ],
    },
    { group: "forgejo", facts: [{ key: "version", value: "16.0.5", severity: "info", freshForS: 900 }] },
    { group: "disk", facts: [{ key: "percent", value: 16, unit: "%", freshForS: 900 }] },
    { group: "watchdog", facts: [{ key: "reachable", value: true, freshForS: 900 }] },
  ],
};

describe("FactsPayload", () => {
  it("accepts the sample-derived payload", () => {
    expect(FactsPayload.parse(facts).groups).toHaveLength(6);
  });
  it("rejects unsafe strings, type mismatches, duplicates and oversize groups", () => {
    const unsafe = structuredClone(facts);
    unsafe.groups[1]!.facts[0]!.value = `serve from ${DOC4}`;
    expect(FactsPayload.safeParse(unsafe).success).toBe(false);
    const mismatch = structuredClone(facts);
    (mismatch.groups[2]!.facts[0] as { value: unknown }).value = 5;
    expect(FactsPayload.safeParse(mismatch).success).toBe(false);
    const dup = structuredClone(facts);
    dup.groups[0]!.facts.push({ key: "state", value: "x", severity: "ok", freshForS: 1 });
    expect(FactsPayload.safeParse(dup).success).toBe(false);
    const many = {
      ...facts,
      groups: Array.from({ length: 33 }, (_, i) => ({ group: `g${i}`, facts: facts.groups[4]!.facts })),
    };
    expect(FactsPayload.safeParse(many).success).toBe(false);
    expect(FactsPayload.safeParse({ ...facts, producer: DOC4 }).success).toBe(false);
  });
});

describe("EventsPayload", () => {
  const events = {
    v: 1,
    generatedAt: "2026-09-27T23:58:00Z",
    producer: "watch-1",
    services: [
      { externalId: "watchdog", name: "Watchdog", kind: "push", targetDisplay: null, intervalS: 60 },
    ],
    heartbeats: [
      { externalId: "watchdog", ts: "2026-09-27T23:57:00Z", status: "up", latencyMs: null, message: "ok" },
    ],
    facts: [{ group: "tailnet", key: "online", value: 6, freshForS: 900 }],
  };
  it("accepts heartbeats and facts", () => {
    expect(EventsPayload.parse(events).heartbeats).toHaveLength(1);
    expect(EventsPayload.safeParse({ ...events, heartbeats: undefined, services: undefined }).success).toBe(
      true,
    );
  });
  it("rejects empty batches, unknown status, unsafe messages and too many beats", () => {
    expect(
      EventsPayload.safeParse({ v: 1, generatedAt: events.generatedAt, producer: "watch-1" }).success,
    ).toBe(false);
    expect(
      EventsPayload.safeParse({ ...events, heartbeats: [{ ...events.heartbeats[0], status: "green" }] })
        .success,
    ).toBe(false);
    expect(
      EventsPayload.safeParse({
        ...events,
        heartbeats: [{ ...events.heartbeats[0], message: ["Bearer", "abc123"].join(" ") }],
      }).success,
    ).toBe(false);
    const many = Array.from({ length: INGEST_LIMITS.eventHeartbeats + 1 }, () => events.heartbeats[0]);
    expect(EventsPayload.safeParse({ ...events, heartbeats: many }).success).toBe(false);
  });
});

describe("ModelDelta", () => {
  it("type compiles and schema accepts a normalized delta", () => {
    const delta: ModelDelta = {
      site: "demo",
      generatedAt: "2026-09-27T23:58:00Z",
      source: { sourceId: "kuma:watch-1", seenAt: "2026-09-27T23:58:01Z", ok: true, error: null },
      services: [
        {
          id: "kuma:8",
          site: "demo",
          source: "kuma:watch-1",
          externalId: "8",
          name: "Runner ping",
          kind: "ping",
          targetDisplay: "runner-1",
          intervalS: 60,
          status: "up",
          latencyMs: 1,
          avgLatencyMs: 1,
          uptime24h: 1,
          uptime30d: 1,
        },
      ],
      heartbeats: [
        {
          site: "demo",
          serviceId: "kuma:8",
          ts: "2026-09-27T23:57:30Z",
          status: "up",
          latencyMs: 1,
          message: "1 ms",
          important: false,
        },
      ],
      facts: [
        {
          site: "demo",
          source: "kuma:watch-1",
          group: "kuma",
          key: "version",
          value: { type: "string", value: "2.5.5" },
          unit: null,
          severity: "info",
          observedAt: "2026-09-27T23:58:00Z",
          freshForS: 300,
        },
      ],
    };
    expect(ModelDelta.parse(delta)).toEqual(delta);
    expect(ModelDelta.safeParse({ ...delta, source: { ...delta.source, sourceId: "kuma" } }).success).toBe(
      false,
    );
  });
});
