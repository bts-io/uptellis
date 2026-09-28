import { SELF } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { PUBLIC_FIELDS, type PublicField, type SiteConfig } from "@/shared/config";
import { PublicSummary } from "@/shared/public/summary";
import { type AppEnv, platformContext } from "@/worker/app-env";
import { isWorkerOwned } from "@/worker/build";
import type { ConfigSource } from "@/worker/engine/sites";
import { seedConfig, seedConfigs } from "@/worker/engine/sites";
import { BADGE_CACHE, publicRoutes, SUMMARY_CACHE } from "@/worker/routes/public";
import { loadFixture } from "../fixtures";
import { fetchWith } from "../support/platform";
import { MemoryModelCache, MemoryStore } from "../support/read-memory-store";

// The public routes as src/worker/index.ts mounts them, over the fixture in memory, with the demo site's
// visibility and `public` block set per test.
const fx = loadFixture("incident");
const NOW = Date.parse(fx.now);

let store: MemoryStore;
let handle: (path: string, init?: RequestInit) => Promise<Response>;
let site: Pick<SiteConfig, "visibility" | "public">;

const configs: ConfigSource = {
  slugs: seedConfigs.slugs,
  current: async (slug) => {
    const state = await seedConfigs.current(slug);
    return state && { ...state, config: { ...seedConfig(slug)!, ...site } };
  },
};

const publish = (fields: PublicField[]) => {
  site = { visibility: "public", public: { enabled: true, fields } };
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
  const cache = new MemoryModelCache();
  publish([...PUBLIC_FIELDS]);
  const app = new Hono<AppEnv>().use(platformContext);
  app.route(
    "/",
    publicRoutes(() => ({ store, cache, configs }), { now: () => NOW }),
  );
  app.notFound((c) => c.json({ error: "not_found", message: "Not found" }, 404));
  handle = (path, init) => fetchWith(app, new Request(`https://example.com${path}`, init));
});

const ALL_PATHS = [
  "/api/public/demo/summary.json",
  "/badge/demo.svg",
  "/badge/demo/kuma:1.svg",
  "/badge/demo/kuma:1.svg?metric=uptime",
  "/embed/demo",
];

/** The body and the headers a 404 is judged by: every hidden case must look the same. */
const shape404 = async (res: Response) => ({
  status: res.status,
  type: res.headers.get("content-type"),
  cache: res.headers.get("cache-control"),
  cors: res.headers.get("access-control-allow-origin"),
  body: await res.text(),
});

describe("public summary", () => {
  it("serves the summary with CORS and a 30 s cache", async () => {
    const res = await handle("/api/public/demo/summary.json", { headers: { origin: "https://example.org" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("cache-control")).toBe(SUMMARY_CACHE);
    const body = PublicSummary.parse(await res.json());
    expect(body.site).toEqual({ slug: "demo", name: seedConfig("demo")!.name });
    expect(body.verdict?.state).toBe("outage");
    expect(body.sections?.length).toBeGreaterThan(0);
    expect(body.incidents?.some((i) => i.endedAt === null)).toBe(true);
    expect(body.generatedAt).toBeDefined();
  });

  it("answers the CORS preflight for GET only", async () => {
    const res = await handle("/api/public/demo/summary.json", {
      method: "OPTIONS",
      headers: { origin: "https://example.org", "access-control-request-method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect((await handle("/api/public/demo/summary.json", { method: "POST" })).status).toBe(404);
  });

  it("shares only the allowed parts", async () => {
    publish(["verdict"]);
    const body = await (await handle("/api/public/demo/summary.json")).json();
    expect(Object.keys(body as object).sort()).toEqual(["site", "v", "verdict"]);
  });

  it("is the same 404 for an unknown, a private and an unpublished site", async () => {
    const unknown = await shape404(await handle("/api/public/nope/summary.json"));
    expect(unknown.status).toBe(404);
    expect(unknown.cors).toBe("*");
    expect(unknown.cache).toBe("no-store");

    site = { visibility: "private", public: { enabled: true, fields: [...PUBLIC_FIELDS] } };
    expect(await shape404(await handle("/api/public/demo/summary.json"))).toEqual(unknown);
    site = { visibility: "public", public: { enabled: false, fields: [...PUBLIC_FIELDS] } };
    expect(await shape404(await handle("/api/public/demo/summary.json"))).toEqual(unknown);
    expect(store.loads).toBe(0);
  });

  it("hides every route of a private site with every field allowed, and of an unpublished one", async () => {
    const hiddenSites: (typeof site)[] = [
      { visibility: "private", public: { enabled: true, fields: [...PUBLIC_FIELDS] } },
      { visibility: "public", public: { enabled: false, fields: [...PUBLIC_FIELDS] } },
    ];
    for (const hidden of hiddenSites) {
      site = hidden;
      for (const path of ALL_PATHS) {
        const res = await handle(path);
        expect(res.status, `${hidden.visibility} ${path}`).toBe(404);
        const unknown = await handle(path.replace("demo", "nope"));
        expect(await shape404(res), path).toEqual(await shape404(unknown));
      }
    }
    expect(store.loads).toBe(0);
  });
});

describe("badges", () => {
  const svgOk = (res: Response) => {
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("cache-control")).toBe(BADGE_CACHE);
  };

  it("draws the verdict badge", async () => {
    const res = await handle("/badge/demo.svg");
    svgOk(res);
    const svg = await res.text();
    expect(svg).toContain(`${seedConfig("demo")!.name}: outage`);
    expect(svg).toContain('fill="#e05d44"');
  });

  it("draws service badges by id, named only with serviceNames", async () => {
    publish(["sections"]);
    const byId = await handle("/badge/demo/kuma:1.svg");
    svgOk(byId);
    expect(await byId.text()).toContain("<title>kuma:1: up</title>");

    publish(["sections", "serviceNames"]);
    const encoded = await handle("/badge/demo/kuma%3A1.svg?metric=status");
    svgOk(encoded);
    expect(await encoded.text()).toContain("<title>API health: up</title>");
  });

  it("draws the uptime metric with uptime90d", async () => {
    publish(["sections", "uptime90d"]);
    const res = await handle("/badge/demo/kuma:1.svg?metric=uptime");
    svgOk(res);
    expect(await res.text()).toMatch(/<title>kuma:1: (\d+(\.\d+)?%|no data)<\/title>/);
  });

  it("is 404 for a part the site does not share, an unknown service or metric", async () => {
    const cases: [PublicField[], string][] = [
      [["sections", "serviceNames", "uptime90d"], "/badge/demo.svg"],
      [["verdict", "serviceNames", "uptime90d"], "/badge/demo/kuma:1.svg"],
      [["verdict", "sections"], "/badge/demo/kuma:1.svg?metric=uptime"],
      [[...PUBLIC_FIELDS], "/badge/demo/kuma:999.svg"],
      [[...PUBLIC_FIELDS], "/badge/demo/kuma:1.svg?metric=latency"],
      [[...PUBLIC_FIELDS], "/badge/demo/kuma:1.png"],
      [[...PUBLIC_FIELDS], "/badge/demo.png"],
    ];
    const unknown = await shape404(await handle("/badge/nope.svg"));
    expect(unknown).toMatchObject({ status: 404, cache: "no-store", body: "Not found" });
    for (const [fields, path] of cases) {
      publish(fields);
      expect(await shape404(await handle(path)), `${fields.join(",")} ${path}`).toEqual(unknown);
    }
  });
});

describe("embeds", () => {
  it("serves the widget page for a published site", async () => {
    publish(["verdict", "sections", "serviceNames"]);
    const res = await handle("/embed/demo");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("1 service down");
    expect(html).toContain("API health");
    expect(html).toContain(`href="https://${seedConfig("demo")!.hostnames[0]}/"`);
    expect(html).not.toMatch(/<script/i);
  });

  it("shows no service without sections", async () => {
    publish(["verdict"]);
    const html = (await (await handle("/embed/demo")).text()).split("<body>")[1]!;
    expect(html).not.toContain("uw-svc");
    expect(html).not.toContain("API health");
  });

  it("serves the script", async () => {
    const res = await handle("/embed.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await res.text()).toContain("data-uptellis");
  });
});

describe("mounted in the Worker", () => {
  it("answers the public paths anonymously, 404 for the unpublished demo site", async () => {
    for (const path of [...ALL_PATHS, "/api/public/nope/summary.json"]) {
      const res = await SELF.fetch(`https://example.com${path}`);
      expect(res.status, path).toBe(404);
      await res.body?.cancel();
    }
    const script = await SELF.fetch("https://example.com/embed.js");
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("summary.json");
  });
});

describe("routing to the Hono app", () => {
  it("sends the public paths to the API, not to page rendering", () => {
    for (const p of [
      "/api/public/demo/summary.json",
      "/badge/demo.svg",
      "/badge/demo/kuma:1.svg",
      "/embed/demo",
      "/embed.js",
    ]) {
      expect(isWorkerOwned(p), p).toBe(true);
    }
    for (const p of ["/", "/admin", "/embedded", "/badges", "/embed.jsx", "/demo"])
      expect(isWorkerOwned(p), p).toBe(false);
  });
});
