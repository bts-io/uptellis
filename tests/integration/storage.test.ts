import { and, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { Fact, Heartbeat, Incident, Service, Source } from "@/shared/model";
import { schema } from "@/worker/db";
import { D1Store } from "@/worker/engine/d1-store";
import { RETIRED_NOTE } from "@/worker/engine/incidents";
import { KvModelCache, latestKey } from "@/worker/engine/kv-cache";
import { RECENT_BEATS, type SiteModel } from "@/worker/engine/store";
import { testPlatform, workerEnv } from "../support/platform";
import { beat, delta, deltaOf, fixtureFor, service } from "./storage-helpers";

const platform = testPlatform();
const db = platform.db;
const store = new D1Store(platform);

async function rows(table: "services" | "heartbeats" | "facts" | "factSamples" | "incidents", site: string) {
  const t = schema[table];
  const [r] = await db.select({ n: count() }).from(t).where(eq(t.site, site));
  return r?.n ?? 0;
}

describe("D1Store.applyDelta", () => {
  it("stores the default fixture, opens one incident from the incident fixture and resolves it on up", async () => {
    const site = "t-apply";
    const base = fixtureFor("default", site);
    const numeric = base.facts.filter((f) => f.value.type === "number").length;

    const first = await store.applyDelta(deltaOf(base));
    expect(first).toEqual({
      servicesUpserted: base.services.length,
      heartbeatsInserted: base.heartbeats.length,
      factsUpserted: base.facts.length,
      incidentsOpened: [],
      incidentsResolved: [],
    });
    expect(await rows("services", site)).toBe(base.services.length);
    expect(await rows("heartbeats", site)).toBe(base.heartbeats.length);
    expect(await rows("facts", site)).toBe(base.facts.length);
    expect(await rows("factSamples", site)).toBe(numeric);
    expect(await rows("incidents", site)).toBe(0);

    // A replay changes nothing.
    const replay = await store.applyDelta(deltaOf(base));
    expect(replay.heartbeatsInserted).toBe(0);
    expect(replay.incidentsOpened).toEqual([]);
    expect(await rows("heartbeats", site)).toBe(base.heartbeats.length);

    // kuma:5 goes down at 23:52 (the incident fixture).
    const inc = fixtureFor("incident", site);
    const expected = inc.incidents.find((i) => i.endedAt === null);
    const down = await store.applyDelta(deltaOf(inc));
    expect(down.heartbeatsInserted).toBe(6);
    expect(down.incidentsOpened).toEqual([expected]);
    expect(down.incidentsOpened[0]?.id).toBe("kuma:5:2026-09-27T23:52:00Z");
    expect(down.incidentsResolved).toEqual([]);
    expect((await store.currentServices(site)).find((s) => s.id === "kuma:5")?.status).toBe("down");

    // Idempotent: the same delta again opens nothing.
    const again = await store.applyDelta(deltaOf(inc));
    expect(again.incidentsOpened).toEqual([]);
    expect(await rows("incidents", site)).toBe(1);

    // An up beat resolves it.
    const upService = { ...inc.services.find((s) => s.id === "kuma:5")!, status: "up" as const };
    const up = await store.applyDelta(
      delta(site, "2026-09-27T23:58:30Z", {
        services: [upService],
        heartbeats: [beat(site, "kuma:5", "2026-09-27T23:58:00Z", "up", 210)],
      }),
    );
    expect(up.incidentsOpened).toEqual([]);
    expect(up.incidentsResolved).toEqual([{ ...expected, endedAt: "2026-09-27T23:58:00Z" }]);
    const [row] = await db
      .select()
      .from(schema.incidents)
      .where(and(eq(schema.incidents.site, site), eq(schema.incidents.id, expected!.id)));
    expect(row?.endedAt).toBe(Date.parse("2026-09-27T23:58:00Z"));

    // Replaying the old down delta after the recovery does not reopen it.
    const late = await store.applyDelta(deltaOf(inc));
    expect(late.incidentsOpened).toEqual([]);
    expect(late.incidentsResolved).toEqual([]);
  });

  it("does not let an older delta overwrite newer service rows or facts", async () => {
    const site = "t-order";
    await store.applyDelta(delta(site, "2026-09-27T10:00:00Z", { services: [service(site, "1", "down")] }));
    await store.applyDelta(delta(site, "2026-09-27T09:00:00Z", { services: [service(site, "1", "up")] }));
    expect((await store.currentServices(site))[0]?.status).toBe("down");

    const fact = (value: number, observedAt: string): Fact => ({
      site,
      source: "kuma:watch-1",
      group: "disk",
      key: "percent",
      value: { type: "number", value },
      unit: "%",
      severity: null,
      observedAt,
      freshForS: 900,
    });
    await store.applyDelta(
      delta(site, "2026-09-27T10:00:00Z", { facts: [fact(60, "2026-09-27T10:00:00Z")] }),
    );
    const old = await store.applyDelta(
      delta(site, "2026-09-27T09:00:00Z", { facts: [fact(40, "2026-09-27T09:00:00Z")] }),
    );
    expect(old.factsUpserted).toBe(0);
    const model = await store.loadSiteModel(site, "2026-09-27T10:01:00Z");
    expect(model.facts[0]?.value).toEqual({ type: "number", value: 60 });
    // Both samples are kept as history.
    expect(await rows("factSamples", site)).toBe(2);
  });

  it("chunks large deltas under the bound-parameter limit", async () => {
    const site = "t-chunk";
    const svc = Array.from({ length: 40 }, (_, i) => service(site, String(i + 1), "up"));
    const beats = svc.flatMap((s) =>
      Array.from({ length: 10 }, (_, j) =>
        beat(site, s.id, new Date(Date.parse("2026-09-27T10:00:00Z") + j * 60_000).toISOString(), "up", 5),
      ),
    );
    const r = await store.applyDelta(
      delta(site, "2026-09-27T10:10:00Z", { services: svc, heartbeats: beats }),
    );
    expect(r.servicesUpserted).toBe(40);
    expect(r.heartbeatsInserted).toBe(400);
    expect(await rows("heartbeats", site)).toBe(400);
  });

  it("rejects rows of another site", async () => {
    await expect(
      store.applyDelta(
        delta("t-mixed", "2026-09-27T10:00:00Z", { services: [service("t-other", "1", "up")] }),
      ),
    ).rejects.toThrow(/site/);
  });
});

describe("D1Store.claimNonce", () => {
  it("accepts a nonce once and refuses a replay", async () => {
    expect(await store.claimNonce("nonce-one", "2026-09-27T11:00:00Z")).toBe(true);
    expect(await store.claimNonce("nonce-one", "2026-09-27T11:00:00Z")).toBe(false);
    expect(await store.claimNonce("nonce-two", "2026-09-27T11:00:00Z")).toBe(true);
  });
});

describe("D1Store.loadSiteModel", () => {
  it("assembles the model: sources, services, capped recent beats, incidents and facts", async () => {
    const site = "t-model";
    const inc = fixtureFor("incident", site);
    await store.applyDelta(deltaOf(fixtureFor("default", site)));
    await store.applyDelta(deltaOf(inc));
    // More than RECENT_BEATS beats for one service.
    const many = Array.from({ length: RECENT_BEATS + 12 }, (_, i) =>
      beat(
        site,
        "kuma:1",
        new Date(Date.parse("2026-09-27T20:00:00Z") + i * 60_000).toISOString(),
        "up",
        100,
      ),
    );
    await store.applyDelta(delta(site, "2026-09-27T23:58:00Z", { heartbeats: many }));

    const model: SiteModel = await store.loadSiteModel(site, inc.now);
    expect(model.site).toBe(site);
    expect(model.generatedAt).toBe(inc.now);
    expect(Object.keys(model).sort()).toEqual(
      [
        "facts",
        "generatedAt",
        "openIncidents",
        "recentHeartbeats",
        "recentIncidents",
        "services",
        "site",
        "sources",
      ].sort(),
    );

    // Everything parses through the model's own schemas.
    for (const s of model.sources) Source.parse(s);
    for (const s of model.services) Service.parse(s);
    for (const h of model.recentHeartbeats) Heartbeat.parse(h);
    for (const i of [...model.openIncidents, ...model.recentIncidents]) Incident.parse(i);
    for (const f of model.facts) Fact.parse(f);

    expect(model.sources).toEqual([
      {
        id: "kuma:watch-1",
        site,
        kind: "kuma",
        expectedIntervalS: 60,
        lastSeenAt: inc.now,
        lastOkAt: inc.now,
      },
    ]);
    // Services round-trip exactly (optional fields such as cert stay absent when unset).
    const byId = new Map(inc.services.map((s) => [s.id, s]));
    expect(model.services).toHaveLength(inc.services.length);
    for (const s of model.services) expect(s).toEqual(byId.get(s.id));
    // Natural order by external id.
    expect(model.services.map((s) => s.id)).toEqual(
      [...inc.services].map((s) => s.id).sort((a, b) => a.length - b.length || a.localeCompare(b)),
    );

    // Heartbeats: capped per service, newest first within a service.
    const perService = new Map<string, string[]>();
    for (const h of model.recentHeartbeats)
      perService.set(h.serviceId, [...(perService.get(h.serviceId) ?? []), h.ts]);
    expect(perService.get("kuma:1")).toHaveLength(RECENT_BEATS);
    for (const list of perService.values()) {
      expect(list.length).toBeLessThanOrEqual(RECENT_BEATS);
      expect([...list].sort().reverse()).toEqual(list);
    }
    expect(perService.get("kuma:1")?.[0]).toBe("2026-09-27T23:57:41Z");

    expect(model.openIncidents.map((i) => i.id)).toEqual(["kuma:5:2026-09-27T23:52:00Z"]);
    expect(model.recentIncidents.map((i) => i.id)).toContain("kuma:5:2026-09-27T23:52:00Z");

    // Facts keep their tagged values, including timestamp and boolean.
    // The default fixture's facts, overwritten by the incident fixture's (which drops one).
    const facts = new Map(
      [...fixtureFor("default", site).facts, ...inc.facts].map((f) => [`${f.group}/${f.key}`, f]),
    );
    expect(model.facts).toHaveLength(facts.size);
    for (const f of model.facts) expect(f).toEqual(facts.get(`${f.group}/${f.key}`));
  });

  it("returns an empty model for an unknown site", async () => {
    const m = await store.loadSiteModel("t-nobody", "2026-09-27T10:00:00Z");
    expect(m).toEqual({
      site: "t-nobody",
      generatedAt: "2026-09-27T10:00:00Z",
      sources: [],
      services: [],
      recentHeartbeats: [],
      openIncidents: [],
      recentIncidents: [],
      facts: [],
    });
  });
});

describe("D1Store.sweepStaleness", () => {
  it("opens a stale incident for a silent source and resolves it when the source reports again", async () => {
    const site = "t-stale";
    await store.syncSources(site, [{ id: "kuma:watch-1", kind: "kuma", expectedIntervalS: 60 }]);
    await store.applyDelta(delta(site, "2026-09-27T10:00:00Z", { services: [service(site, "1", "up")] }));

    // Aging (4 minutes) is not stale.
    expect((await store.sweepStaleness(site, "2026-09-27T10:04:00Z")).incidentsOpened).toEqual([]);

    const swept = await store.sweepStaleness(site, "2026-09-27T10:06:00Z");
    expect(swept.incidentsOpened).toEqual([
      {
        id: "kuma:watch-1:2026-09-27T10:05:00Z",
        site,
        kind: "stale",
        serviceId: null,
        sourceId: "kuma:watch-1",
        startedAt: "2026-09-27T10:05:00Z",
        endedAt: null,
        title: "Source kuma:watch-1 stale",
        notes: null,
      },
    ]);
    // Idempotent.
    expect((await store.sweepStaleness(site, "2026-09-27T10:07:00Z")).incidentsOpened).toEqual([]);
    expect((await store.loadSiteModel(site, "2026-09-27T10:07:00Z")).openIncidents).toHaveLength(1);

    // The source comes back: applyDelta resolves the stale incident in the same batch.
    const back = await store.applyDelta(
      delta(site, "2026-09-27T10:20:00Z", { services: [service(site, "1", "up")] }),
    );
    expect(back.incidentsResolved).toEqual([
      { ...swept.incidentsOpened[0], endedAt: "2026-09-27T10:20:00Z" },
    ]);
    expect((await store.loadSiteModel(site, "2026-09-27T10:21:00Z")).openIncidents).toEqual([]);
  });

  it("resolves a retired source's stale incident with a note and never reopens it", async () => {
    const site = "t-retired";
    await store.syncSources(site, [{ id: "kuma:watch-1", kind: "kuma", expectedIntervalS: 60 }]);
    await store.applyDelta(delta(site, "2026-09-27T10:00:00Z", {}));
    const open = await store.sweepStaleness(site, "2026-09-27T10:06:00Z");
    expect(open.incidentsOpened).toHaveLength(1);

    // The source left the config: watched no longer lists it.
    const retired = await store.sweepStaleness(site, "2026-09-27T10:30:00Z", new Set());
    expect(retired.incidentsOpened).toEqual([]);
    expect(retired.incidentsResolved).toEqual([
      { ...open.incidentsOpened[0], endedAt: "2026-09-27T10:30:00Z", notes: RETIRED_NOTE },
    ]);
    const model = await store.loadSiteModel(site, "2026-09-27T11:00:00Z");
    expect(model.openIncidents).toEqual([]);
    expect(model.recentIncidents.find((i) => i.sourceId === "kuma:watch-1")?.notes).toBe(RETIRED_NOTE);
    expect((await store.sweepStaleness(site, "2026-09-27T12:00:00Z", new Set())).incidentsOpened).toEqual([]);
  });

  it("keeps the configured interval when a source is touched by ingest", async () => {
    const site = "t-interval";
    await store.syncSources(site, [{ id: "kuma:watch-1", kind: "kuma", expectedIntervalS: 600 }]);
    await store.applyDelta(delta(site, "2026-09-27T10:00:00Z", {}));
    // 30 minutes is aging at a 600 s interval, so nothing opens.
    expect((await store.sweepStaleness(site, "2026-09-27T10:30:00Z")).incidentsOpened).toEqual([]);
    expect((await store.loadSiteModel(site, "2026-09-27T10:30:00Z")).sources[0]?.expectedIntervalS).toBe(600);
    expect(await store.listSites()).toContain(site);
  });
});

describe("KvModelCache", () => {
  const model = (generatedAt: string): SiteModel => ({
    site: "t-kv",
    generatedAt,
    sources: [],
    services: [],
    recentHeartbeats: [],
    openIncidents: [],
    recentIncidents: [],
    facts: [],
  });

  it("stores latest:<site> and never overwrites it with an older model", async () => {
    const cache = new KvModelCache(platform.kv);
    expect(await cache.get("t-kv")).toBeNull();
    await cache.put(model("2026-09-27T10:00:00Z"));
    await cache.put(model("2026-09-27T09:59:00Z"));
    expect((await cache.get("t-kv"))?.generatedAt).toBe("2026-09-27T10:00:00Z");
    expect(await workerEnv.CACHE.get(latestKey("t-kv"), "json")).toMatchObject({
      generatedAt: "2026-09-27T10:00:00Z",
    });
    await cache.put(model("2026-09-27T10:01:00Z"));
    expect((await workerEnv.CACHE.get<SiteModel>(latestKey("t-kv"), "json"))?.generatedAt).toBe(
      "2026-09-27T10:01:00Z",
    );
  });
});
