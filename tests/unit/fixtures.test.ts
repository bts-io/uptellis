import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSiteConfig } from "@/shared/config/site";
import { Fact, type FactValue, Heartbeat, Incident, Service, Site, Source } from "@/shared/model";
import { FIXTURE_NAMES, FixtureHistory, type FixtureModel, loadFixture, rawFixture } from "../fixtures";

const NAMES = [
  "API health",
  "Web app",
  "Primary Postgres",
  "Primary SSH",
  "Replica Postgres",
  "Replica SSH",
  "Runner ping",
  "Runner SSH",
];
const STANDBY_PG = "kuma:5";
const JS_TYPE = { string: "string", number: "number", boolean: "boolean", timestamp: "string" } as const;
const SITE_CONFIG = parseSiteConfig(readFileSync(new URL("../../sites/demo.json", import.meta.url), "utf8"));
const ms = (iso: string) => Date.parse(iso);
const fact = (f: FixtureModel, group: string, key: string) =>
  f.facts.find((x) => x.group === group && x.key === key);
/** The plain value of a fact (unwrapped from its tagged union). */
const val = (f: FixtureModel, group: string, key: string): FactValue["value"] | undefined =>
  fact(f, group, key)?.value.value;

describe.each(FIXTURE_NAMES)("fixture %s", (name) => {
  const f = loadFixture(name);
  const serviceIds = new Set(f.services.map((s) => s.id));

  it("parses entity by entity through the model's Zod schemas", () => {
    const raw = rawFixture(name) as Record<string, unknown[]> & { site: unknown };
    expect(Site.parse(raw.site)).toEqual(raw.site);
    const each = [
      ["sources", Source],
      ["services", Service],
      ["heartbeats", Heartbeat],
      ["incidents", Incident],
      ["facts", Fact],
      ["history", FixtureHistory],
    ] as const;
    for (const [key, schema] of each) {
      expect(raw[key]!.length).toBeGreaterThan(0);
      for (const entity of raw[key]!) {
        const r = schema.safeParse(entity);
        expect(r.error?.issues ?? [], `${key} ${JSON.stringify(entity).slice(0, 80)}`).toEqual([]);
        // No field outside the model: parsing (which strips unknown keys) must not lose anything.
        expect(r.data).toEqual(entity);
      }
    }
  });

  // The fixtures hold the Kuma and facts data only; the edge probes (source probe:cf) are covered by
  // tests/unit/theme-a-probes.test.ts.
  it("matches sites/demo.json: site, sources, and section membership", () => {
    expect(f.site).toMatchObject({ slug: SITE_CONFIG.slug, name: SITE_CONFIG.name });
    expect(f.site.hostnames).toEqual(["status.example.com"]);
    expect(f.site.hostnames).toEqual(SITE_CONFIG.hostnames);
    expect(f.sources.map(({ id, kind, expectedIntervalS }) => ({ id, kind, expectedIntervalS }))).toEqual(
      SITE_CONFIG.sources.filter((s) => s.kind !== "probe"),
    );
    const sectioned = SITE_CONFIG.sections
      .flatMap((s) => s.services)
      .filter((id) => !id.startsWith("probe:"));
    expect(new Set(sectioned).size).toBe(sectioned.length);
    expect([...sectioned].sort()).toEqual([...serviceIds].sort());
    for (const svc of f.services) expect(f.sources.map((s) => s.id)).toContain(svc.source);
    for (const x of f.facts) expect(f.sources.map((s) => s.id)).toContain(x.source);
  });

  it("uses UTC Z timestamps only", () => {
    const stamps = [
      f.now,
      ...f.sources.flatMap((s) => [s.lastSeenAt, s.lastOkAt]),
      ...f.heartbeats.map((h) => h.ts),
      ...f.incidents.flatMap((i) => [i.startedAt, i.endedAt]),
      ...f.facts.map((x) => x.observedAt),
      ...f.facts.filter((x) => x.value.type === "timestamp").map((x) => String(x.value.value)),
      ...f.services.flatMap((s) => (s.cert ? [s.cert.validTo] : [])),
    ].filter((t): t is string => t !== null);
    for (const t of stamps) expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("has the site, both sources and a valid now", () => {
    expect(f.site.slug).toBe("demo");
    expect(Number.isNaN(ms(f.now))).toBe(false);
    const kuma = f.sources.find((s) => s.id === "kuma:watch-1");
    const facts = f.sources.find((s) => s.id === "facts:app-1");
    expect(kuma).toMatchObject({ kind: "kuma", expectedIntervalS: 60 });
    expect(facts).toMatchObject({ kind: "facts", expectedIntervalS: 900 });
  });

  it("has the 8 real services with kuma ids", () => {
    expect(f.services.map((s) => s.name)).toEqual(NAMES);
    for (const s of f.services) {
      expect(s.id).toBe(`kuma:${s.externalId}`);
      expect(s.source).toBe("kuma:watch-1");
      expect(s.site).toBe("demo");
      for (const u of [s.uptime24h, s.uptime30d]) {
        expect(u).not.toBeNull();
        expect(u!).toBeGreaterThanOrEqual(0);
        expect(u!).toBeLessThanOrEqual(1);
      }
    }
    expect(serviceIds.size).toBe(8);
  });

  it("shows hostnames, not addresses, as targets", () => {
    const targets = Object.fromEntries(f.services.map((s) => [s.name, s.targetDisplay]));
    expect(targets).toMatchObject({
      "Primary Postgres": "app-1:5432",
      "Primary SSH": "app-1:22",
      "Replica Postgres": "app-2:5432",
      "Replica SSH": "app-2:22",
      "Runner ping": "runner-1",
      "Runner SSH": "runner-1:22",
    });
  });

  it("has 90 consecutive daily history cells per service, ending on the snapshot day", () => {
    expect(f.history.map((h) => h.serviceId).sort()).toEqual([...serviceIds].sort());
    for (const h of f.history) {
      expect(h.days).toHaveLength(90);
      expect(h.days.at(-1)!.day).toBe("2026-09-27");
      for (let i = 1; i < h.days.length; i++) {
        expect(ms(h.days[i]!.day) - ms(h.days[i - 1]!.day)).toBe(86_400_000);
      }
      for (const c of h.days) {
        expect(c.uptime).toBeCloseTo((1440 - c.minutesDown) / 1440, 5);
      }
    }
  });

  it("follows the beatBarNote", () => {
    const worstDays = (id: string, worst: string) =>
      f.history
        .find((h) => h.serviceId === id)!
        .days.filter((d) => d.worst === worst)
        .map((d) => d.day);
    for (const id of ["kuma:5", "kuma:6"]) {
      expect(worstDays(id, "down")).toEqual(expect.arrayContaining(["2026-09-15", "2026-09-16"]));
    }
    expect(worstDays("kuma:1", "degraded")).toEqual(["2026-09-25"]);
    for (const id of ["kuma:2", "kuma:3", "kuma:4", "kuma:8", "kuma:9"]) {
      expect(f.history.find((h) => h.serviceId === id)!.days.every((d) => d.worst === "up")).toBe(true);
    }
  });

  it("links heartbeats and incidents to known services, 5+ recent beats each, none in the future", () => {
    for (const hb of f.heartbeats) {
      expect(serviceIds.has(hb.serviceId)).toBe(true);
      expect(ms(hb.ts)).toBeLessThanOrEqual(ms(f.now));
      expect(hb.message).not.toBe("");
    }
    for (const id of serviceIds) {
      expect(f.heartbeats.filter((h) => h.serviceId === id).length).toBeGreaterThanOrEqual(5);
    }
    for (const inc of f.incidents) {
      expect(inc).toMatchObject({ kind: "down", sourceId: null });
      expect(serviceIds.has(inc.serviceId!)).toBe(true);
      expect(inc.id).toBe(`${inc.serviceId}:${inc.startedAt}`);
      expect(inc.id).toMatch(/^[A-Za-z0-9:._-]+$/);
    }
    expect(new Set(f.incidents.map((i) => i.id)).size).toBe(f.incidents.length);
  });

  it("has every fact group, kuma facts from kuma:watch-1 and the rest from facts:app-1", () => {
    expect([...new Set(f.facts.map((x) => x.group))].sort()).toEqual(
      ["backup", "disk", "fence", "forgejo", "kuma", "replication", "runners", "watchdog"].sort(),
    );
    for (const x of f.facts) {
      expect(x.source).toBe(x.group === "kuma" ? "kuma:watch-1" : "facts:app-1");
      expect(typeof x.value.value).toBe(JS_TYPE[x.value.type]);
    }
    expect(fact(f, "disk", "sizeBytes")).toMatchObject({ value: { type: "number" }, unit: "bytes" });
    expect(fact(f, "watchdog", "reachable")?.value).toEqual({ type: "boolean", value: true });
    expect(val(f, "runners", "list")).toBe("runner-1 idle, watch-1 idle");
    expect(val(f, "kuma", "version")).toBe("2.5.5");
    expect(fact(f, "backup", "lastAt")?.value.type).toBe("timestamp");
  });

  it("schedules the next backup after now, at 23:30 UTC, and after the last one", () => {
    const next = String(val(f, "backup", "nextAt"));
    const last = String(val(f, "backup", "lastAt"));
    expect(ms(next)).toBeGreaterThan(ms(f.now));
    expect(ms(next)).toBeGreaterThan(ms(last));
    expect(next.slice(11)).toBe("23:30:00Z");
  });
});

describe("fixture default", () => {
  const f = loadFixture("default");
  it("is all up, fresh and has no open incident", () => {
    expect(f.services.every((s) => s.status === "up")).toBe(true);
    expect(f.incidents.filter((i) => i.endedAt === null)).toEqual([]);
    for (const s of f.sources) {
      expect(ms(f.now) - ms(s.lastSeenAt!)).toBeLessThan(2 * s.expectedIntervalS * 1000);
    }
    expect(val(f, "replication", "state")).toBe("streaming");
    expect(f.facts.every((x) => x.severity === "ok" || x.severity === null)).toBe(true);
  });
});

describe("fixture stale", () => {
  const f = loadFixture("stale");
  const d = loadFixture("default");
  it("is older than 5x the kuma interval: 14 minutes after the last kuma snapshot", () => {
    const kuma = f.sources.find((s) => s.id === "kuma:watch-1")!;
    const ageS = (ms(f.now) - ms(kuma.lastSeenAt!)) / 1000;
    expect(ageS).toBe(14 * 60);
    expect(ageS).toBeGreaterThan(5 * kuma.expectedIntervalS);
  });
  it("is 14+ minutes after the facts too", () => {
    const facts = f.sources.find((s) => s.id === "facts:app-1")!;
    expect(ms(f.now) - ms(facts.lastSeenAt!)).toBeGreaterThanOrEqual(14 * 60_000);
  });
  it("differs from default only in now", () => {
    expect({ ...f, now: d.now }).toEqual(d);
  });
});

describe("fixture incident", () => {
  const f = loadFixture("incident");
  const open = () => f.incidents.filter((i) => i.endedAt === null);
  it("has exactly one open incident, on Replica Postgres, 6 minutes old", () => {
    expect(open()).toHaveLength(1);
    expect(open()[0]).toMatchObject({
      serviceId: STANDBY_PG,
      sourceId: null,
      kind: "down",
      title: "Replica Postgres down",
    });
    expect(ms(f.now) - ms(open()[0]!.startedAt)).toBe(6 * 60_000);
  });
  it("marks Replica Postgres down with timeout beats, the first one important", () => {
    const svc = f.services.find((s) => s.id === STANDBY_PG)!;
    expect(svc).toMatchObject({ status: "down", latencyMs: null, uptime24h: 0.9958, uptime30d: 0.9985 });
    expect(f.services.filter((s) => s.status !== "up").map((s) => s.id)).toEqual([STANDBY_PG]);
    const beats = f.heartbeats.filter((h) => h.serviceId === STANDBY_PG).sort((a, b) => ms(a.ts) - ms(b.ts));
    expect(beats.slice(-5).every((b) => b.status === "down" && b.message === "timeout")).toBe(true);
    expect(beats[0]).toMatchObject({ important: true, ts: open()[0]!.startedAt });
    expect(f.history.find((h) => h.serviceId === STANDBY_PG)!.days.at(-1)).toMatchObject({
      worst: "down",
      minutesDown: 6,
    });
  });
  it("has no standby streaming and an unreachable peer, as push-facts.sh reports it", () => {
    expect(fact(f, "replication", "state")).toMatchObject({ value: { value: "none" }, severity: "warn" });
    expect(fact(f, "replication", "peerReachable")).toMatchObject({
      value: { value: false },
      severity: "warn",
    });
    expect(fact(f, "replication", "lagSeconds")).toBeUndefined();
    expect(fact(f, "fence", "peerRole")).toBeUndefined();
  });
});
