import { describe, expect, it } from "vitest";
import { parseSiteConfig } from "@/shared/config";
import demo from "../../sites/demo.json";
import { buildSourcesReport, isoSeconds, readSiteModel } from "../../src/worker/engine/read-service";
import { getSiteConfig, seedConfig, seedConfigs, seedSlugs } from "../../src/worker/engine/sites";
import type { SiteModel } from "../../src/worker/engine/store";
import { loadFixture } from "../fixtures";
import { MemoryModelCache, MemoryStore } from "../support/read-memory-store";

const fx = loadFixture("default");
const NOW = Date.parse(fx.now);
const seeded = () =>
  new MemoryStore({
    demo: {
      sources: fx.sources,
      services: fx.services,
      heartbeats: fx.heartbeats,
      incidents: fx.incidents,
      facts: fx.facts,
    },
  });

describe("site registry", () => {
  it("knows the committed sites and nothing else", async () => {
    expect(seedSlugs()).toEqual(["demo"]);
    expect(seedConfig("demo")?.name).toBe(demo.name);
    expect(await seedConfigs.slugs()).toEqual(["demo"]);
    expect(await seedConfigs.current("demo")).toMatchObject({ version: 1, savedBy: "seed" });
    for (const slug of ["nope", "DEMO", "", "../demo", "demo/"]) {
      expect(seedConfig(slug)).toBeNull();
      expect(await getSiteConfig(seedConfigs, slug)).toBeNull();
    }
  });
});

describe("readSiteModel", () => {
  it("assembles from the store on a cold cache, then warms the cache", async () => {
    const store = seeded();
    const cache = new MemoryModelCache();
    const first = await readSiteModel({ store, cache }, "demo", NOW);
    expect(first.from).toBe("store");
    expect(first.model.generatedAt).toBe(fx.now);
    expect(first.model.services).toHaveLength(fx.services.length);
    await first.warmed;
    expect(cache.puts).toBe(1);

    const second = await readSiteModel({ store, cache }, "demo", NOW + 1000);
    expect(second.from).toBe("cache");
    expect(second.model).toEqual(first.model);
    expect(store.loads).toBe(1);
  });

  it("serves a cached model without touching the store", async () => {
    const store = seeded();
    const cache = new MemoryModelCache();
    const model: SiteModel = await seeded().loadSiteModel("demo", fx.now);
    await cache.put(model);
    const read = await readSiteModel({ store, cache }, "demo", NOW);
    expect(read.from).toBe("cache");
    expect(store.loads).toBe(0);
  });

  it("falls back to the store when the cache read fails, and survives a failed warm-up", async () => {
    const store = seeded();
    const broken = {
      get: async () => {
        throw new Error("kv down");
      },
      put: async () => {
        throw new Error("kv down");
      },
    };
    const read = await readSiteModel({ store, cache: broken }, "demo", NOW);
    expect(read.from).toBe("store");
    await expect(read.warmed).resolves.toBeUndefined();
  });

  it("propagates a store failure on a cold cache", async () => {
    const store = seeded();
    store.loadSiteModel = async () => {
      throw new Error("d1 down");
    };
    await expect(readSiteModel({ store, cache: new MemoryModelCache() }, "demo", NOW)).rejects.toThrow(
      "d1 down",
    );
  });
});

describe("buildSourcesReport", () => {
  const config = seedConfig("demo")!;
  const modelAt = async (name: "default" | "stale") => {
    const f = loadFixture(name);
    const store = new MemoryStore({ demo: { sources: f.sources } });
    return { model: await store.loadSiteModel("demo", f.now), now: Date.parse(f.now) };
  };

  it("reports age and freshness at request time", async () => {
    const { model, now } = await modelAt("default");
    const r = buildSourcesReport(config, model, now);
    expect(r.site).toBe("demo");
    expect(r.now).toBe(isoSeconds(now));
    expect(isoSeconds(now + 999)).toBe(isoSeconds(now));
    expect(r.sources.map((s) => [s.id, s.ageS, s.freshness])).toEqual([
      ["kuma:watch-1", 34, "fresh"],
      ["facts:app-1", 780, "fresh"],
      ["probe:cf", null, "empty"],
    ]);
  });

  it("moves through aging to stale as time passes, with the same model", async () => {
    const { model, now } = await modelAt("default");
    const kuma = (t: number) => buildSourcesReport(config, model, t).sources[0]!;
    expect(kuma(now + 200_000)).toMatchObject({ ageS: 234, freshness: "aging" });
    expect(kuma(now + 900_000)).toMatchObject({ ageS: 934, freshness: "stale" });
  });

  it("matches the stale fixture", async () => {
    const { model, now } = await modelAt("stale");
    const r = buildSourcesReport(config, model, now);
    expect(r.sources.find((s) => s.id === "kuma:watch-1")?.freshness).toBe("stale");
    expect(r.sources.find((s) => s.id === "facts:app-1")?.freshness).toBe("fresh");
  });

  it("lists configured sources the store has never seen as empty, and leaves out retired model sources", async () => {
    const withExtra = parseSiteConfig({
      ...demo,
      sources: [...demo.sources, { id: "webhook:ci", kind: "webhook", expectedIntervalS: 300 }],
    });
    const later = isoSeconds(Date.parse(fx.now) + 20_000);
    const model = await new MemoryStore({
      demo: {
        sources: [
          ...fx.sources,
          {
            id: "probe:edge",
            site: "demo",
            kind: "probe",
            expectedIntervalS: 60,
            lastSeenAt: later,
            lastOkAt: later,
          },
        ],
      },
    }).loadSiteModel("demo", fx.now);
    const r = buildSourcesReport(withExtra, model, NOW);
    expect(r.sources.map((s) => [s.id, s.freshness, s.ageS])).toEqual([
      ["kuma:watch-1", "fresh", 34],
      ["facts:app-1", "fresh", 780],
      ["probe:cf", "empty", null],
      ["webhook:ci", "empty", null],
    ]);
    expect(r.sources[3]).toMatchObject({ lastSeenAt: null, lastOkAt: null, expectedIntervalS: 300 });
    // The retired `probe:edge` reported last, yet `generatedAt` is the page's: the newest listed source.
    expect(r.generatedAt).toBe("2026-09-27T23:57:26Z");
  });

  it("counts clock skew into the future as age 0", async () => {
    const { model, now } = await modelAt("default");
    expect(buildSourcesReport(config, model, now - 3_600_000).sources[0]).toMatchObject({
      ageS: 0,
      freshness: "fresh",
    });
  });
});
