import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { findForbiddenLiterals } from "@/shared/model";
import type { SiteModel } from "../../src/worker/engine/store";
import { type ViewerEnv, viewerGate } from "../../src/worker/middleware/viewer-key";
import { readRoutes } from "../../src/worker/routes/read";
import { loadFixture } from "../fixtures";
import { MemoryModelCache, MemoryStore } from "../support/read-memory-store";

// The read sub-app mounted exactly as the lead mounts it, behind the same viewer gate src/server.ts runs
// first. VIEWER_KEY comes from vitest.config.ts, so the gate is armed.
const KEY = "test-viewer-key";
const fx = loadFixture("default");
const NOW = Date.parse(fx.now);

let store: MemoryStore;
let cache: MemoryModelCache;
let handle: (path: string, init?: RequestInit) => Promise<Response>;

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
  const app = new Hono<{ Bindings: Env }>();
  app.route(
    "/api/sites",
    readRoutes(() => ({ store, cache }), { now: () => NOW }),
  );
  app.notFound((c) => c.json({ error: "not_found", message: "Not found" }, 404));
  handle = async (path, init) => {
    const req = new Request(`https://example.com${path}`, { redirect: "manual", ...init });
    return (await viewerGate(req, env as unknown as ViewerEnv, NOW)) ?? app.fetch(req, env);
  };
});

async function viewerCookie(): Promise<string> {
  const res = await handle(`/api/sites/demo/model?key=${KEY}`);
  expect(res.status).toBe(302);
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

describe("read API behind the viewer gate", () => {
  it("answers 404 without the viewer cookie and never reaches the store", async () => {
    for (const path of ["/api/sites/demo/model", "/api/sites/demo/sources"]) {
      const res = await handle(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_found" });
      const bad = await handle(path, { headers: { cookie: "uptellis_view=123.abc" } });
      expect(bad.status).toBe(404);
    }
    expect(store.loads).toBe(0);
    expect(cache.gets).toBe(0);
  });

  it("serves the model with the cookie: store on a cold cache, then KV", async () => {
    const cookie = await viewerCookie();
    const res = await handle("/api/sites/demo/model", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const model = (await res.json()) as SiteModel;
    expect(model.site).toBe("demo");
    expect(model.generatedAt).toBe(fx.now);
    expect(model.services).toHaveLength(fx.services.length);
    expect(model.openIncidents.every((i) => i.endedAt === null)).toBe(true);
    expect(store.loads).toBe(1);
    expect(cache.models.has("demo")).toBe(true);

    const again = await handle("/api/sites/demo/model", { headers: { cookie } });
    expect(await again.json()).toEqual(model);
    expect(store.loads).toBe(1);
  });

  it("prefers a cached model over the store", async () => {
    const cookie = await viewerCookie();
    const cached = await new MemoryStore({ demo: { sources: fx.sources } }).loadSiteModel(
      "demo",
      "2026-09-27T23:50:00Z",
    );
    await cache.put(cached);
    const model = (await (
      await handle("/api/sites/demo/model", { headers: { cookie } })
    ).json()) as SiteModel;
    expect(model.generatedAt).toBe("2026-09-27T23:50:00Z");
    expect(model.services).toEqual([]);
    expect(store.loads).toBe(0);
  });

  it("reports sources with age and freshness", async () => {
    const cookie = await viewerCookie();
    const res = await handle("/api/sites/demo/sources", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      site: "demo",
      now: fx.now,
      generatedAt: fx.now,
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
    const cookie = await viewerCookie();
    const body = (await (await handle("/api/sites/demo/sources", { headers: { cookie } })).json()) as {
      sources: { freshness: string; ageS: number | null }[];
    };
    expect(body.sources.map((s) => [s.freshness, s.ageS])).toEqual([
      ["empty", null],
      ["empty", null],
      ["empty", null],
    ]);
  });

  it("answers 404 with no-store for unknown sites and unknown paths", async () => {
    const cookie = await viewerCookie();
    for (const path of ["/api/sites/nope/model", "/api/sites/nope/sources", "/api/sites/DEMO/model"]) {
      const res = await handle(path, { headers: { cookie } });
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "not_found", message: "Unknown site" });
    }
    expect((await handle("/api/sites/demo/other", { headers: { cookie } })).status).toBe(404);
    expect(store.loads).toBe(0);
  });

  it("leaks no address, email or token in either response", async () => {
    const cookie = await viewerCookie();
    for (const path of ["/api/sites/demo/model", "/api/sites/demo/sources"]) {
      const text = await (await handle(path, { headers: { cookie } })).text();
      expect(findForbiddenLiterals(text)).toEqual([]);
    }
  });
});
