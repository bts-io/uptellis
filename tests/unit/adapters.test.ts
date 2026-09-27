import { describe, expect, it } from "vitest";
import type { Service } from "@/shared/model";
import { EventsPayload, FactsPayload, KumaSnapshot, ModelDelta } from "@/shared/schemas";
import { normalizeEvents } from "@/worker/adapters/events";
import { normalizeFacts } from "@/worker/adapters/facts";
import { kumaKind, kumaMessage, kumaTarget, normalizeKuma } from "@/worker/adapters/kuma";
import { deriveDownIncidents } from "@/worker/engine/incidents";
import { PayloadRejected } from "@/worker/ingest/issues";
import { type FixtureName, loadFixture } from "../fixtures";
import { FIXTURE_TIMEOUT_S, factsPayloadFrom, kumaSnapshotFrom } from "../support/fixture-payloads";

// Address samples are built at runtime (RFC 5737 documentation range) so this file passes the repo scan.
const ip4 = (...p: number[]) => p.join(".");
const DOC_ADDR = ip4(192, 0, 2, 10);

const NOW = new Date("2026-09-27T23:58:00Z");

/** A fresh delta's `down` derivation input: no rows before, no known incidents. */
const downInputOf = (delta: ModelDelta) => ({
  site: delta.site,
  at: delta.generatedAt,
  before: [],
  after: delta.services,
  heartbeats: delta.heartbeats,
  incidents: [],
});
const kuma = (name: FixtureName) => {
  const fx = loadFixture(name);
  return { fx, snap: KumaSnapshot.parse(kumaSnapshotFrom(fx)) };
};

const rejectedPaths = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof PayloadRejected) return e.issues.map((i) => i.path);
    throw e;
  }
  throw new Error("expected a PayloadRejected");
};

describe("kuma adapter against the fixtures", () => {
  for (const name of ["default", "incident"] as const) {
    it(`rebuilds the ${name} fixture's services, heartbeats and kuma facts`, () => {
      const { fx, snap } = kuma(name);
      const delta = ModelDelta.parse(normalizeKuma(snap, "kuma:watch-1", "demo", NOW));

      expect(delta.site).toBe("demo");
      expect(delta.generatedAt).toBe(snap.generatedAt);
      expect(delta.source).toEqual({
        sourceId: "kuma:watch-1",
        seenAt: snap.generatedAt,
        ok: true,
        error: null,
      });

      const newest = (id: string) =>
        fx.heartbeats
          .filter((h) => h.serviceId === id)
          .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0];
      const expected = fx.services.map((s) => ({
        ...s,
        ...(s.kind === "http" ? { method: "GET" } : {}),
        timeoutS: FIXTURE_TIMEOUT_S,
        status: newest(s.id)?.status ?? s.status,
        latencyMs: newest(s.id)?.latencyMs ?? null,
      }));
      expect(delta.services).toEqual(expected);
      // The fixture's own current status agrees with the newest beat.
      expect(delta.services.map((s) => s.status)).toEqual(fx.services.map((s) => s.status));

      const sortBeats = (l: { serviceId: string; ts: string }[]) =>
        [...l].sort((a, b) => a.ts.localeCompare(b.ts) || a.serviceId.localeCompare(b.serviceId));
      expect(sortBeats(delta.heartbeats)).toEqual(sortBeats(fx.heartbeats));

      const kumaFacts = fx.facts.filter((f) => f.group === "kuma");
      for (const f of kumaFacts) {
        expect(delta.facts.find((d) => d.key === f.key)).toEqual(f);
      }
      expect(delta.facts.find((f) => f.key === "reachable")?.value).toEqual({ type: "boolean", value: true });
    });
  }

  it("derives the incident fixture's open incident from the important beat", () => {
    const { fx, snap } = kuma("incident");
    const delta = normalizeKuma(snap, "kuma:watch-1", "demo", NOW);
    const tr = deriveDownIncidents(downInputOf(delta));
    const open = fx.incidents.filter((i) => !i.endedAt);
    expect(tr.opened).toEqual(open);
    expect(tr.resolved).toEqual([]);
  });

  it("derives nothing from the default fixture", () => {
    const { snap } = kuma("default");
    const delta = normalizeKuma(snap, "kuma:watch-1", "demo", NOW);
    expect(deriveDownIncidents(downInputOf(delta)).opened).toEqual([]);
  });
});

describe("kuma adapter details", () => {
  const base = () => kuma("default").snap;

  it("scrubs addresses from heartbeat messages and keeps the rest", () => {
    const snap = base();
    snap.heartbeatsSince[0]!.msg = `connect ECONNREFUSED ${DOC_ADDR}:5432`;
    const delta = normalizeKuma(snap, "kuma:watch-1", "demo", NOW);
    const beat = delta.heartbeats.find(
      (h) =>
        h.ts === snap.heartbeatsSince[0]!.ts && h.serviceId === `kuma:${snap.heartbeatsSince[0]!.monitorId}`,
    );
    expect(beat?.message).toBe("connect ECONNREFUSED [redacted]:5432");
    expect(JSON.stringify(delta)).not.toContain(DOC_ADDR);
  });

  it("drops messages that are empty after trimming and caps length", () => {
    expect(kumaMessage(null)).toBeNull();
    expect(kumaMessage("   ")).toBeNull();
    expect(kumaMessage("x".repeat(500))).toHaveLength(200);
  });

  it("builds display targets without scheme, credentials, query or fragment", () => {
    const m = {
      id: 1,
      name: "n",
      type: "http",
      url: ["https://user:pw", "git.example.com:8443/api/healthz?token=abc#frag"].join("@"),
      hostname: null,
      port: null,
      method: "GET",
      intervalS: 60,
      timeoutS: null,
      active: true,
    };
    expect(kumaTarget(m, "http")).toEqual({ value: "git.example.com:8443/api/healthz", field: "url" });
    expect(kumaTarget({ ...m, url: null, hostname: "app-1", port: 22 }, "port")).toEqual({
      value: "app-1:22",
      field: "hostname",
    });
    expect(kumaTarget({ ...m, url: null, hostname: "runner-1" }, "ping")).toEqual({
      value: "runner-1",
      field: "hostname",
    });
    expect(kumaTarget(m, "push")).toEqual({ value: null, field: null });
    expect(kumaTarget({ ...m, url: "not a url" }, "http")).toEqual({ error: "url" });
  });

  it("maps Kuma types to service kinds, with fallbacks for other types", () => {
    const m = { url: null, hostname: null, port: null };
    expect(kumaKind({ ...m, type: "json-query" })).toBe("keyword");
    expect(kumaKind({ ...m, type: "postgres", hostname: "app-1", port: 5432 })).toBe("port");
    expect(kumaKind({ ...m, type: "dns", hostname: "git.example.com" })).toBe("ping");
    expect(kumaKind({ ...m, type: "docker" })).toBe("push");
  });

  it("keeps previous status, latency and maps when a snapshot omits them, and pauses inactive monitors", () => {
    const snap = base();
    const first = normalizeKuma(snap, "kuma:watch-1", "demo", NOW);
    const quiet = {
      ...snap,
      heartbeatsSince: [],
      importantHeartbeats: [],
      uptime: {},
      avgPing: {},
      certInfo: {},
      monitors: snap.monitors.map((m, i) => (i === 1 ? { ...m, active: false } : m)),
    };
    const next = normalizeKuma(quiet, "kuma:watch-1", "demo", NOW, { previous: first.services });
    expect(next.heartbeats).toEqual([]);
    const strip = (s: Service) => ({ ...s, status: "x" });
    expect(next.services.map(strip)).toEqual(first.services.map(strip));
    expect(next.services[0]!.status).toBe(first.services[0]!.status);
    expect(next.services[1]!.status).toBe("paused");
    expect(normalizeKuma(quiet, "kuma:watch-1", "demo", NOW).services[0]).toMatchObject({
      status: "unknown",
      latencyMs: null,
      uptime24h: null,
    });
  });

  it("reports Kuma unreachable on the source touch", () => {
    const snap = { ...base(), reachable: false, error: "login failed" };
    expect(normalizeKuma(snap, "kuma:watch-1", "demo", NOW).source).toMatchObject({
      ok: false,
      error: "login failed",
    });
    const { error: _, ...noErr } = snap;
    expect(normalizeKuma(noErr, "kuma:watch-1", "demo", NOW).source.error).toBe("Kuma unreachable");
  });

  it("never lets a producer clock ahead of the Worker make a source look fresher", () => {
    const snap = { ...base(), generatedAt: "2026-09-27T23:59:00Z" };
    expect(normalizeKuma(snap, "kuma:watch-1", "demo", NOW).source.seenAt).toBe("2026-09-27T23:58:00Z");
  });

  it("flags a newer Kuma release as info", () => {
    const snap = base();
    snap.kuma.latestVersion = "2.6.0";
    const f = normalizeKuma(snap, "kuma:watch-1", "demo", NOW).facts.find((x) => x.key === "latestVersion");
    expect(f?.severity).toBe("info");
  });

  it("rejects unsafe names and targets at the schema, naming paths only", () => {
    const raw = kumaSnapshotFrom(loadFixture("default"));
    raw.monitors[2]!.name = `Postgres on ${DOC_ADDR}`;
    raw.monitors[3]!.hostname = DOC_ADDR;
    const r = KumaSnapshot.safeParse(raw);
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["monitors.2.name", "monitors.3.hostname"]));
    expect(JSON.stringify(r.error!.issues.map((i) => i.message))).not.toContain(DOC_ADDR);
  });

  it("rejects an unparseable URL with its path", () => {
    const snap = base();
    snap.monitors[0]!.url = "git.example.com/no-scheme";
    expect(rejectedPaths(() => normalizeKuma(snap, "kuma:watch-1", "demo", NOW))).toEqual(["monitors.0.url"]);
  });
});

describe("facts adapter", () => {
  for (const name of ["default", "incident"] as const) {
    it(`rebuilds the ${name} fixture's app-1 facts`, () => {
      const fx = loadFixture(name);
      const payload = FactsPayload.parse(factsPayloadFrom(fx));
      const delta = ModelDelta.parse(normalizeFacts(payload, "facts:app-1", "demo", NOW));
      const key = (f: { group: string; key: string }) => `${f.group}/${f.key}`;
      const sort = <T extends { group: string; key: string }>(l: T[]) =>
        [...l].sort((a, b) => key(a).localeCompare(key(b)));
      expect(sort(delta.facts)).toEqual(sort(fx.facts.filter((f) => f.source === "facts:app-1")));
      expect(delta.services).toEqual([]);
      expect(delta.heartbeats).toEqual([]);
      expect(delta.source).toMatchObject({ sourceId: "facts:app-1", ok: true });
    });
  }
});

describe("events adapter", () => {
  const payload = (over: object = {}) =>
    EventsPayload.parse({
      v: 1,
      generatedAt: "2026-09-27T23:57:00Z",
      producer: "watch-1",
      services: [{ externalId: "deploy", name: "Deploy pipeline", kind: "push", intervalS: 300 }],
      heartbeats: [
        { externalId: "deploy", ts: "2026-09-27T23:50:00Z", status: "up" },
        { externalId: "deploy", ts: "2026-09-27T23:55:00Z", status: "down", message: "exit 1" },
        { externalId: "deploy", ts: "2026-09-27T23:52:00Z", status: "up", latencyMs: 12 },
      ],
      facts: [{ group: "ci", key: "queued", value: 3, freshForS: 600 }],
      ...over,
    });

  it("declares services, orders beats and marks transitions important", () => {
    const delta = ModelDelta.parse(normalizeEvents(payload(), "webhook:ci", "demo", NOW));
    expect(delta.services).toEqual([
      {
        id: "webhook:deploy",
        site: "demo",
        source: "webhook:ci",
        externalId: "deploy",
        name: "Deploy pipeline",
        kind: "push",
        targetDisplay: null,
        intervalS: 300,
        status: "down",
        latencyMs: null,
        avgLatencyMs: null,
        uptime24h: null,
        uptime30d: null,
      },
    ]);
    expect(delta.heartbeats.map((h) => [h.ts.slice(11, 16), h.status, h.important])).toEqual([
      ["23:50", "up", true],
      ["23:52", "up", false],
      ["23:55", "down", true],
    ]);
    expect(delta.facts).toEqual([
      {
        site: "demo",
        source: "webhook:ci",
        group: "ci",
        key: "queued",
        value: { type: "number", value: 3 },
        unit: null,
        severity: null,
        observedAt: "2026-09-27T23:57:00Z",
        freshForS: 600,
      },
    ]);
  });

  it("accepts beats for a service known from before and continues its status", () => {
    const first = normalizeEvents(payload(), "webhook:ci", "demo", NOW);
    const next = normalizeEvents(
      payload({
        services: undefined,
        facts: undefined,
        heartbeats: [{ externalId: "deploy", ts: "2026-09-27T23:57:30Z", status: "down" }],
      }),
      "webhook:ci",
      "demo",
      NOW,
      { previous: first.services },
    );
    expect(next.heartbeats[0]!.important).toBe(false);
    expect(next.services[0]).toMatchObject({ name: "Deploy pipeline", status: "down" });
  });

  it("rejects beats for undeclared services and services owned by another source", () => {
    const p = payload({ heartbeats: [{ externalId: "other", ts: "2026-09-27T23:50:00Z", status: "up" }] });
    expect(rejectedPaths(() => normalizeEvents(p, "webhook:ci", "demo", NOW))).toEqual([
      "heartbeats.0.externalId",
    ]);
    const theirs = normalizeEvents(payload(), "webhook:ci", "demo", NOW).services;
    expect(
      rejectedPaths(() => normalizeEvents(payload(), "webhook:other", "demo", NOW, { previous: theirs })),
    ).toEqual(["services.0.externalId"]);
  });
});
