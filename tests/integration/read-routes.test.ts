import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/shared/auth";
import { findForbiddenLiterals } from "@/shared/model";
import { type AppEnv, platformContext } from "@/worker/app-env";
import type { ConfigSource } from "@/worker/engine/sites";
import { seedConfig, seedConfigs } from "@/worker/engine/sites";
import type { SiteModel } from "../../src/worker/engine/store";
import { readRoutes } from "../../src/worker/routes/read";
import { loadFixture } from "../fixtures";
import { fetchWith } from "../support/platform";
import { MemoryModelCache, MemoryStore } from "../support/read-memory-store";

// The read sub-app as src/worker/index.ts mounts it, with the principal the accounts middleware would
// resolve set directly. The committed demo site is public; `configs` can make it private.
const fx = loadFixture("default");
const NOW = Date.parse(fx.now);

let store: MemoryStore;
let cache: MemoryModelCache;
let handle: (path: string, init?: RequestInit) => Promise<Response>;
let principal: Principal;
let configs: ConfigSource;

/** The committed configs with demo made private. */
const privateDemo: ConfigSource = {
  slugs: seedConfigs.slugs,
  current: async (slug) => {
    const state = await seedConfigs.current(slug);
    return state && { ...state, config: { ...seedConfig(slug)!, visibility: "private" } };
  },
};

beforeEach(() => {
  store = new MemoryStore({
    demo: {
      sources: fx.sources,
      services: fx.services,
      heartbeats: fx.heartbeats,
      incidents: fx.incidents,
      facts: fx.facts,
    },
  });
  cache = new MemoryModelCache();
  principal = { kind: "anonymous" };
  configs = seedConfigs;
  const app = new Hono<AppEnv>().use(platformContext);
  app.use("*", async (c, next) => {
    c.set("principal", principal);
    await next();
  });
  app.route(
    "/api/sites",
    readRoutes(() => ({ store, cache, configs }), { now: () => NOW }),
  );
  app.notFound((c) => c.json({ error: "not_found", message: "Not found" }, 404));
  handle = async (path, init) => fetchWith(app, new Request(`https://example.com${path}`, init));
});

describe("read API and site visibility", () => {
  const paths = ["/api/sites/demo/model", "/api/sites/demo/sources", "/api/sites/demo/view"];

  it("answers 404 for a private site to anyone who may not view it, and never reaches the store", async () => {
    configs = privateDemo;
    const denied: Principal[] = [
      { kind: "anonymous" },
      { kind: "apiKey", keyId: "k1", site: "other", scopes: ["read"] },
      { kind: "apiKey", keyId: "k2", site: "demo", scopes: ["ingest"] },
    ];
    for (const p of denied) {
      principal = p;
      for (const path of paths) {
        const res = await handle(path);
        expect(res.status, `${p.kind} ${path}`).toBe(404);
        expect(await res.json()).toEqual({ error: "not_found", message: "Unknown site" });
      }
    }
    expect(store.loads).toBe(0);
    expect(cache.gets).toBe(0);
  });

  it("serves a private site to a signed-in user and to a read key of that site", async () => {
    configs = privateDemo;
    const allowed: Principal[] = [
      { kind: "user", userId: "u1", role: "viewer" },
      { kind: "apiKey", keyId: "k3", site: "demo", scopes: ["read"] },
    ];
    for (const p of allowed) {
      principal = p;
      for (const path of paths) expect((await handle(path)).status, `${p.kind} ${path}`).toBe(200);
    }
  });

  it("serves a public site to anyone", async () => {
    for (const path of paths) expect((await handle(path)).status, path).toBe(200);
  });

  it("serves the model: store on a cold cache, then KV", async () => {
    const res = await handle("/api/sites/demo/model");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const model = (await res.json()) as SiteModel;
    expect(model.site).toBe("demo");
    expect(model.generatedAt).toBe(fx.now);
    expect(model.services).toHaveLength(fx.services.length);
    expect(model.openIncidents.every((i) => i.endedAt === null)).toBe(true);
    expect(store.loads).toBe(1);
    expect(cache.models.has("demo")).toBe(true);

    const again = await handle("/api/sites/demo/model");
    expect(await again.json()).toEqual(model);
    expect(store.loads).toBe(1);
  });

  it("prefers a cached model over the store", async () => {
    const cached = await new MemoryStore({ demo: { sources: fx.sources } }).loadSiteModel(
      "demo",
      "2026-09-27T23:50:00Z",
    );
    await cache.put(cached);
    const model = (await (await handle("/api/sites/demo/model")).json()) as SiteModel;
    expect(model.generatedAt).toBe("2026-09-27T23:50:00Z");
    expect(model.services).toEqual([]);
    expect(store.loads).toBe(0);
  });

  it("reports sources with age and freshness", async () => {
    const res = await handle("/api/sites/demo/sources");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      site: "demo",
      now: fx.now,
      // The page's `generatedAt`: the newest `lastSeenAt` of the listed sources (Kuma).
      generatedAt: "2026-09-27T23:57:26Z",
      sources: [
        {
          id: "kuma:watch-1",
          kind: "kuma",
          expectedIntervalS: 60,
          lastSeenAt: "2026-09-27T23:57:26Z",
          lastOkAt: "2026-09-27T23:57:26Z",
          ageS: 34,
          freshness: "fresh",
        },
        {
          id: "facts:app-1",
          kind: "facts",
          expectedIntervalS: 900,
          lastSeenAt: "2026-09-27T23:45:00Z",
          lastOkAt: "2026-09-27T23:45:00Z",
          ageS: 780,
          freshness: "fresh",
        },
        {
          id: "probe:cf",
          kind: "probe",
          expectedIntervalS: 60,
          lastSeenAt: null,
          lastOkAt: null,
          ageS: null,
          freshness: "empty",
        },
      ],
    });
  });

  it("reports a never-seen site as empty sources", async () => {
    store = new MemoryStore();
    const body = (await (await handle("/api/sites/demo/sources")).json()) as {
      sources: { freshness: string; ageS: number | null }[];
    };
    expect(body.sources.map((s) => [s.freshness, s.ageS])).toEqual([
      ["empty", null],
      ["empty", null],
      ["empty", null],
    ]);
  });

  it("answers 404 with no-store for unknown sites and unknown paths", async () => {
    for (const path of ["/api/sites/nope/model", "/api/sites/nope/sources", "/api/sites/DEMO/model"]) {
      const res = await handle(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "not_found", message: "Unknown site" });
    }
    expect((await handle("/api/sites/demo/other")).status).toBe(404);
    expect(store.loads).toBe(0);
  });

  it("leaks no address, email or token in either response", async () => {
    for (const path of ["/api/sites/demo/model", "/api/sites/demo/sources"]) {
      const text = await (await handle(path)).text();
      expect(findForbiddenLiterals(text)).toEqual([]);
    }
  });
});
