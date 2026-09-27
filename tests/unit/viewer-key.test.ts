import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  cookieSecret,
  readCookie,
  signViewerCookie,
  VIEWER_COOKIE,
  VIEWER_COOKIE_MAX_AGE,
  verifyViewerCookie,
  viewerGate,
} from "../../src/worker/middleware/viewer-key";

const SECRET = "unit-test-secret";
const NOW = 1_800_000_000;
const env = { VIEWER_KEY: "open-sesame", VIEWER_COOKIE_SECRET: "cookie-secret" };

describe("viewer cookie", () => {
  it("signs a cookie that verifies until it expires", async () => {
    const value = await signViewerCookie(SECRET, NOW);
    expect(value).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    expect(value.split(".")[0]).toBe(String(NOW + VIEWER_COOKIE_MAX_AGE));
    expect(await verifyViewerCookie(value, SECRET, NOW)).toBe(true);
    expect(await verifyViewerCookie(value, SECRET, NOW + VIEWER_COOKIE_MAX_AGE - 1)).toBe(true);
  });

  it("rejects an expired cookie", async () => {
    const value = await signViewerCookie(SECRET, NOW, 60);
    expect(await verifyViewerCookie(value, SECRET, NOW + 60)).toBe(false);
    expect(await verifyViewerCookie(value, SECRET, NOW + 3600)).toBe(false);
  });

  it("rejects a tampered expiry, a tampered signature and a foreign secret", async () => {
    const value = await signViewerCookie(SECRET, NOW);
    const [exp, sig] = value.split(".") as [string, string];
    expect(await verifyViewerCookie(`${Number(exp) + 1}.${sig}`, SECRET, NOW)).toBe(false);
    const flipped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect(await verifyViewerCookie(`${exp}.${flipped}`, SECRET, NOW)).toBe(false);
    expect(await verifyViewerCookie(value, "another-secret", NOW)).toBe(false);
  });

  it("rejects missing and malformed values", async () => {
    for (const v of [null, undefined, "", "abc", "123", "123.", ".abc", "12.a+b/c=", "x.y"]) {
      expect(await verifyViewerCookie(v, SECRET, NOW)).toBe(false);
    }
    expect(await verifyViewerCookie(await signViewerCookie(SECRET, NOW), "", NOW)).toBe(false);
  });

  it("binds cookies to the viewer key, so rotating it revokes them", () => {
    expect(cookieSecret(env)).not.toBe(cookieSecret({ ...env, VIEWER_KEY: "rotated" }));
    expect(cookieSecret({ VIEWER_KEY: "k" })).toBe("k");
  });
});

describe("helpers", () => {
  it("compares strings in constant time", async () => {
    expect(await constantTimeEqual("same", "same")).toBe(true);
    expect(await constantTimeEqual("same", "Same")).toBe(false);
    expect(await constantTimeEqual("short", "a much longer string")).toBe(false);
    expect(await constantTimeEqual("", "")).toBe(true);
  });

  it("reads one cookie out of a header", () => {
    expect(readCookie("a=1; uptellis_view=xyz; b=2", VIEWER_COOKIE)).toBe("xyz");
    expect(readCookie("xuptellis_view=1", VIEWER_COOKIE)).toBeNull();
    expect(readCookie(null, VIEWER_COOKIE)).toBeNull();
  });
});

describe("viewerGate", () => {
  const req = (path: string, init?: RequestInit) => new Request(`https://status.example${path}`, init);
  const nowMs = NOW * 1000;

  it("lets everything through when VIEWER_KEY is unset (local dev)", async () => {
    expect(await viewerGate(req("/"), {}, nowMs)).toBeNull();
    expect(await viewerGate(req("/api/sites/demo/view"), { VIEWER_KEY: "" }, nowMs)).toBeNull();
  });

  it("answers 404 for pages and the API without a cookie", async () => {
    const page = await viewerGate(req("/"), env, nowMs);
    expect(page?.status).toBe(404);
    expect(page?.headers.get("content-type")).toContain("text/plain");
    const api = await viewerGate(req("/api/sites/demo/view"), env, nowMs);
    expect(api?.status).toBe(404);
    expect(await api?.json()).toEqual({ error: "not_found", message: "Not found" });
  });

  it("keeps health and ingest open", async () => {
    expect(await viewerGate(req("/api/health"), env, nowMs)).toBeNull();
    expect(await viewerGate(req("/api/ingest/kuma", { method: "POST" }), env, nowMs)).toBeNull();
    expect((await viewerGate(req("/api/healthz"), env, nowMs))?.status).toBe(404);
  });

  it("trades the right key for a cookie and a redirect without the key", async () => {
    const res = await viewerGate(req("/?theme=a&key=open-sesame"), env, nowMs);
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe("https://status.example/?theme=a");
    const setCookie = res?.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^uptellis_view=\d+\.[A-Za-z0-9_-]+; /);
    for (const attr of ["Max-Age=2592000", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) {
      expect(setCookie).toContain(attr);
    }
    const cookie = setCookie.split(";")[0]!;
    expect(await viewerGate(req("/", { headers: { cookie } }), env, nowMs)).toBeNull();
    expect(await viewerGate(req("/api/x", { headers: { cookie } }), env, nowMs)).toBeNull();
    // Expired 30 days later, and revoked by a new viewer key.
    const later = nowMs + VIEWER_COOKIE_MAX_AGE * 1000;
    expect((await viewerGate(req("/", { headers: { cookie } }), env, later))?.status).toBe(404);
    const rotated = { ...env, VIEWER_KEY: "rotated" };
    expect((await viewerGate(req("/", { headers: { cookie } }), rotated, nowMs))?.status).toBe(404);
  });

  it("answers 404 for a wrong key and sets no cookie", async () => {
    const res = await viewerGate(req("/?key=guess"), env, nowMs);
    expect(res?.status).toBe(404);
    expect(res?.headers.get("set-cookie")).toBeNull();
  });
});
