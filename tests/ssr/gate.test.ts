import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { ownerCookie, send, sessionCookie, testEmail, write } from "./built";

// The built Worker (dist/server): the page gate, the read API's visibility check through the API bridge,
// and the open paths. The committed demo site is public; one case makes it private through the admin API.
const get = (path: string, init?: RequestInit) =>
  SELF.fetch(`https://example.com${path}`, { redirect: "manual", ...init });

let owner = "";
beforeAll(async () => {
  owner = await ownerCookie();
});

describe("built worker", () => {
  it("serves /api/health without a cookie", async () => {
    const res = await get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, service: "uptellis", version: pkg.version });
    // A real build id, not the "dev" fallback: Vite's define reached the bundle.
    expect(body.build).toMatch(/^[a-z0-9]+$/);
    expect(body.build).not.toBe("dev");
  });

  it("renders a public site page for anyone, through the API bridge", async () => {
    const page = await get("/");
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

  it("links a stylesheet that resolves to a real CSS asset", async () => {
    const html = await (await get("/")).text();
    const hrefs = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].map(
      ([tag]) => /href="([^"]+)"/.exec(tag)?.[1],
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/assets\/[^/]+\.css$/);
      // SELF goes straight to the Worker and skips the asset router, so fetch through the ASSETS binding,
      // which serves dist/client exactly as production does for a path excluded from run_worker_first.
      const css = await env.ASSETS.fetch(`https://example.com${href}`);
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

  it("leaves /api/ingest/* and /api/health open", async () => {
    // Ingest reaches its own HMAC check (401).
    const ingest = await get("/api/ingest/kuma", { method: "POST", body: "{}" });
    expect(ingest.status).toBe(401);
    expect(await ingest.json()).toMatchObject({ error: "unauthorized", reason: "missing_headers" });
    expect((await get("/api/health")).status).toBe(200);
    for (const path of ["/api/ingest", "/api/healthz"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not_found", message: "Not found" });
    }
  });

  it("sends a signed-out visitor of the admin UI to sign in, and hides it from a viewer", async () => {
    for (const path of ["/admin", "/admin/sources?x=1"]) {
      const res = await get(path);
      expect(res.status, path).toBe(302);
      expect(res.headers.get("location"), path).toBe(`/sign-in?next=${encodeURIComponent(path)}`);
    }
    expect((await send("/admin", { headers: { cookie: owner } })).status).toBe(200);

    // A viewer, invited and signed in: the admin UI is a 404 page, the admin API a 403.
    const invite = await write("/api/admin/invites", { role: "viewer" }, { cookie: owner });
    expect(invite.status).toBe(201);
    const token = ((await invite.json()) as { url: string }).url.split("/").pop()!;
    const accepted = await write(`/api/invites/${token}/accept`, {
      name: "Viewer",
      email: testEmail("viewer"),
      password: "test-viewer-password",
    });
    expect(accepted.status).toBe(201);
    const viewer = sessionCookie(accepted)!;
    const page = await send("/admin", { headers: { cookie: viewer } });
    expect(page.status).toBe(404);
    expect(await page.text()).not.toContain("admin");
    expect((await send("/api/admin/sites/demo/config", { headers: { cookie: viewer } })).status).toBe(403);
    expect((await send("/", { headers: { cookie: viewer } })).status).toBe(200);
  });

  it("sends a signed-out visitor of a private site to sign-in, and its read API answers 404", async () => {
    const state = (await (
      await send("/api/admin/sites/demo/config", { headers: { cookie: owner } })
    ).json()) as {
      config: Record<string, unknown>;
      version: number;
    };
    const saved = await write(
      "/api/admin/sites/demo/config",
      { config: { ...state.config, visibility: "private" }, baseVersion: state.version },
      { cookie: owner },
      "PUT",
    );
    expect(saved.status).toBe(200);

    const page = await send("/");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("/sign-in?next=%2F");
    expect(await page.text()).not.toContain("DEMO");
    for (const path of ["/api/sites/demo/view", "/api/sites/demo/model", "/api/sites/demo/sources"]) {
      const res = await send(path);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not_found", message: "Unknown site" });
    }
    // The same answer as a site that does not exist.
    expect(await (await send("/api/sites/nope/view")).json()).toEqual({
      error: "not_found",
      message: "Unknown site",
    });

    const signedIn = await send("/", { headers: { cookie: owner } });
    expect(signedIn.status).toBe(200);
    expect(await signedIn.text()).toMatch(/<title>([^<]+ \| )?DEMO status<\/title>/);
    expect((await send("/api/sites/demo/view", { headers: { cookie: owner } })).status).toBe(200);
  });
});
