import { describe, expect, it } from "vitest";
import { adminGate, isAdminPath, isSameOrigin } from "../../src/worker/middleware/admin-key";
import {
  ADMIN_COOKIE,
  adminCookieSecret,
  cookieSecret,
  signViewerCookie,
  type ViewerEnv,
  viewerGate,
} from "../../src/worker/middleware/viewer-key";

const NOW = 1_800_000_000;
const nowMs = NOW * 1000;
const env: ViewerEnv = {
  VIEWER_KEY: "open-sesame",
  VIEWER_COOKIE_SECRET: "cookie-secret",
  ADMIN_KEY: "admin-sesame",
};
const ORIGIN = "https://status.example";
const req = (path: string, init?: RequestInit) => new Request(`${ORIGIN}${path}`, init);

/** Both gates in the order src/server.ts runs them. */
const gates = async (request: Request, e: ViewerEnv = env, at = nowMs) =>
  (await adminGate(request, e, at)) ?? (await viewerGate(request, e, at));

async function adminCookie(e: ViewerEnv = env): Promise<string> {
  const res = await gates(req(`/admin?admin=${e.ADMIN_KEY}`), e);
  return (res?.headers.get("set-cookie") ?? "").split(";")[0]!;
}

describe("admin paths", () => {
  it("covers /admin, /admin/* and /api/admin/* only", () => {
    for (const p of [
      "/admin",
      "/admin/",
      "/admin/sites/demo",
      "/api/admin",
      "/api/admin/sites/demo/config",
    ]) {
      expect(isAdminPath(p)).toBe(true);
    }
    for (const p of ["/", "/administrator", "/api/adminx", "/api/sites/demo/view", "/x/admin"]) {
      expect(isAdminPath(p)).toBe(false);
    }
  });
});

describe("adminGate", () => {
  it("answers 404 on admin pages and API without the admin cookie", async () => {
    const page = await gates(req("/admin"));
    expect(page?.status).toBe(404);
    expect(page?.headers.get("content-type")).toContain("text/plain");
    const api = await gates(req("/api/admin/sites/demo/config"));
    expect(api?.status).toBe(404);
    expect(await api?.json()).toEqual({ error: "not_found", message: "Not found" });
  });

  it("answers 404 even with a viewer cookie", async () => {
    const value = await signViewerCookie(cookieSecret(env), NOW);
    const cookie = `uptellis_view=${value}`;
    expect(await gates(req("/", { headers: { cookie } }))).toBeNull();
    expect((await gates(req("/admin", { headers: { cookie } })))?.status).toBe(404);
    expect((await gates(req("/api/admin/sites/demo/config", { headers: { cookie } })))?.status).toBe(404);
  });

  it("trades ?admin= for a strict cookie and a redirect without the key", async () => {
    const res = await gates(req("/admin?tab=config&admin=admin-sesame"));
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe(`${ORIGIN}/admin?tab=config`);
    const setCookie = res?.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^uptellis_admin=\d+\.[A-Za-z0-9_-]+; /);
    for (const attr of ["Max-Age=2592000", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) {
      expect(setCookie).toContain(attr);
    }
    const cookie = setCookie.split(";")[0]!;
    expect(await gates(req("/admin", { headers: { cookie } }))).toBeNull();
    expect(await gates(req("/api/admin/sites/demo/config", { headers: { cookie } }))).toBeNull();
  });

  it("answers 404 for a wrong key, a POST with the key, and sets no cookie", async () => {
    for (const r of [req("/admin?admin=guess"), req("/admin?admin=open-sesame")]) {
      const res = await gates(r);
      expect(res?.status).toBe(404);
      expect(res?.headers.get("set-cookie")).toBeNull();
    }
    const post = await gates(req("/api/admin/sites/demo/sources?admin=admin-sesame", { method: "POST" }));
    expect(post?.status).toBe(404);
  });

  it("lets the admin cookie pass the viewer gate", async () => {
    const cookie = await adminCookie();
    expect(await gates(req("/", { headers: { cookie } }))).toBeNull();
    expect(await gates(req("/api/sites/demo/view", { headers: { cookie } }))).toBeNull();
    expect(await viewerGate(req("/", { headers: { cookie } }), env, nowMs)).toBeNull();
  });

  it("revokes the cookie when ADMIN_KEY or VIEWER_COOKIE_SECRET rotates, and after 30 days", async () => {
    const cookie = await adminCookie();
    const headers = { cookie };
    for (const e of [
      { ...env, ADMIN_KEY: "rotated" },
      { ...env, VIEWER_COOKIE_SECRET: "rotated" },
    ]) {
      expect((await gates(req("/admin", { headers }), e))?.status).toBe(404);
    }
    expect((await gates(req("/admin", { headers }), env, nowMs + 30 * 86_400_000))?.status).toBe(404);
  });

  it("keeps admin closed when ADMIN_KEY is unset in production, open in local dev", async () => {
    const prod = { VIEWER_KEY: env.VIEWER_KEY, VIEWER_COOKIE_SECRET: env.VIEWER_COOKIE_SECRET };
    expect((await gates(req("/admin"), prod))?.status).toBe(404);
    expect((await gates(req("/admin?admin="), prod))?.status).toBe(404);
    // Without an admin key no cookie verifies, whatever it was signed with.
    expect(adminCookieSecret(prod)).toBe("");
    const forged = `${ADMIN_COOKIE}=${await signViewerCookie(env.VIEWER_COOKIE_SECRET!, NOW)}`;
    expect((await gates(req("/admin", { headers: { cookie: forged } }), prod))?.status).toBe(404);

    expect(await gates(req("/admin"), {})).toBeNull();
    expect(await gates(req("/api/admin/sites/demo/config"), { ADMIN_KEY: "", VIEWER_KEY: "" })).toBeNull();
  });

  it("requires same-origin for mutating admin requests (CSRF)", async () => {
    const cookie = await adminCookie();
    const put = (headers: Record<string, string>) =>
      gates(req("/api/admin/sites/demo/config", { method: "PUT", headers: { cookie, ...headers } }));
    expect(await put({ "sec-fetch-site": "same-origin" })).toBeNull();
    expect(await put({ origin: ORIGIN })).toBeNull();
    const crossSite: Record<string, string>[] = [
      {},
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site", origin: ORIGIN },
      { origin: "https://evil.example" },
      { origin: "null" },
    ];
    for (const headers of crossSite) {
      const res = await put(headers);
      expect(res?.status).toBe(403);
      expect(await res?.json()).toMatchObject({ error: "forbidden" });
    }
    // Reads need no Origin; the CSRF check runs in local dev too.
    expect(await gates(req("/api/admin/sites/demo/config", { headers: { cookie } }))).toBeNull();
    const devPost = await gates(req("/api/admin/sites/demo/sources", { method: "POST" }), {});
    expect(devPost?.status).toBe(403);
  });

  it("reads the same-origin signals", () => {
    expect(isSameOrigin(req("/", { headers: { "sec-fetch-site": "same-origin" } }))).toBe(true);
    expect(isSameOrigin(req("/", { headers: { origin: ORIGIN } }))).toBe(true);
    expect(isSameOrigin(req("/", { headers: { origin: `${ORIGIN}:8443` } }))).toBe(false);
    expect(isSameOrigin(req("/"))).toBe(false);
  });
});
