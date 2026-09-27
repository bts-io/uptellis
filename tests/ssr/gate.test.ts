import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

// The built Worker (dist/server) with VIEWER_KEY set by vitest.config.ts, so the gate is armed.
const KEY = "test-viewer-key";
const get = (path: string, init?: RequestInit) =>
  SELF.fetch(`https://example.com${path}`, { redirect: "manual", ...init });

describe("built worker", () => {
  it("serves /api/health without a cookie", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, service: "uptellis", version: "0.1.0" });
    // A real build id, not the "dev" fallback: Vite's define reached the bundle.
    expect(body.build).toMatch(/^[a-z0-9]+$/);
    expect(body.build).not.toBe("dev");
  });

  it("answers 404 to a page and to the API without the viewer cookie", async () => {
    const page = await get("/");
    expect(page.status).toBe(404);
    expect(await page.text()).not.toContain("uptellis");
    expect((await get("/api/sites/demo/view")).status).toBe(404);
    expect((await get("/?key=wrong")).status).toBe(404);
  });

  it("trades the key for a cookie, then renders the site page through the API bridge", async () => {
    const redirect = await get(`/?key=${KEY}`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://example.com/");
    const cookie = (redirect.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(cookie).toMatch(/^uptellis_view=/);

    const page = await get("/", { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("cache-control")).toBe("no-store");
    const html = await page.text();
    // The loader's in-process call to /api/sites/demo/view picked the theme and titled the page.
    expect(html).toMatch(/<html[^>]*data-theme="a"/);
    expect(html).toMatch(/<title>([^<]+ \| )?DEMO status<\/title>/);
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).toContain('href="/fonts/Geist-Variable.woff2"');
  });

  it("links a stylesheet that resolves to a real CSS asset, while pages stay gated", async () => {
    expect((await get("/")).status).toBe(404);

    const cookie = ((await get(`/?key=${KEY}`)).headers.get("set-cookie") ?? "").split(";")[0]!;
    const html = await (await get("/", { headers: { cookie } })).text();
    const hrefs = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].map(
      ([tag]) => /href="([^"]+)"/.exec(tag)?.[1],
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/assets\/[^/]+\.css$/);
      // SELF goes straight to the Worker and skips the asset router, so fetch through the ASSETS binding,
      // which serves dist/client exactly as production does for a path excluded from run_worker_first.
      const css = await env.ASSETS.fetch(`https://example.com${href}`, { headers: { cookie } });
      expect(css.status).toBe(200);
      expect(css.headers.get("content-type")).toContain("text/css");
      expect((await css.text()).length).toBeGreaterThan(0);
    }

    // The deployed routing: the Worker (and so the gate) runs first for everything but /assets/*, /fonts/*
    // and /favicon.ico.
    // vite.config.ts relaxes this for `vite dev` only; the build must keep it.
    // Non-literal specifier: dist/ only exists after `vite build`, so tsc must not try to resolve it.
    const builtConfig = "../../dist/server/wrangler.json";
    const built = (await import(/* @vite-ignore */ builtConfig)) as {
      default: { assets?: { run_worker_first?: unknown } };
    };
    expect(built.default.assets?.run_worker_first).toEqual([
      "/*",
      "!/assets/*",
      "!/fonts/*",
      "!/favicon.ico",
    ]);
  });

  it("leaves /api/ingest/* and /api/health open and gates every other API path", async () => {
    // No cookie: ingest reaches its own HMAC check (401), not the gate's 404.
    const ingest = await get("/api/ingest/kuma", { method: "POST", body: "{}" });
    expect(ingest.status).toBe(401);
    expect(await ingest.json()).toMatchObject({ error: "unauthorized", reason: "missing_headers" });
    expect((await get("/api/health")).status).toBe(200);

    for (const path of ["/api/sites/demo/model", "/api/sites/demo/sources", "/api/ingest", "/api/healthz"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not_found", message: "Not found" });
    }

    const cookie = ((await get(`/?key=${KEY}`)).headers.get("set-cookie") ?? "").split(";")[0]!;
    const model = await get("/api/sites/demo/model", { headers: { cookie } });
    expect(model.status).toBe(200);
    expect(await model.json()).toMatchObject({ site: "demo" });
    const sources = await get("/api/sites/demo/sources", { headers: { cookie } });
    expect(sources.status).toBe(200);
  });
});
