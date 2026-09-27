import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { seed } from "./seed";

// Security headers and rate limits on the built Worker entry (dist/server), called directly so the env can
// carry an admin key and fake rate limit bindings.
const ORIGIN = "https://status.example.com";
const builtPath = "../../dist/server/index.js";
type Entry = { fetch: (r: Request, e: Env, c: ExecutionContext) => Promise<Response> };
const built = ((await import(/* @vite-ignore */ builtPath)) as { default: Entry }).default;
const baseEnv = { ...(env as unknown as Env), ADMIN_KEY: "test-admin-key" } as Env;

/** A binding that refuses everything, and counts what it was asked. */
const refusing = () => {
  const asked: string[] = [];
  return {
    asked,
    async limit({ key }: { key: string }) {
      asked.push(key);
      return { success: false };
    },
  } as unknown as RateLimit & { asked: string[] };
};

async function send(path: string, init: RequestInit = {}, e: Env = baseEnv): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await built.fetch(new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const cookieFrom = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;
let viewer = "";
let admin = "";

beforeAll(async () => {
  await seed("default");
  viewer = cookieFrom(await send("/?key=test-viewer-key"));
  admin = cookieFrom(await send("/admin?admin=test-admin-key"));
  expect(viewer).toMatch(/^uptellis_view=/);
  expect(admin).toMatch(/^uptellis_admin=/);
});

function expectSecure(res: Response, frame: "DENY" | "SAMEORIGIN", what: string) {
  expect(res.headers.get("strict-transport-security"), what).toBe("max-age=31536000; includeSubDomains");
  expect(res.headers.get("x-content-type-options"), what).toBe("nosniff");
  expect(res.headers.get("referrer-policy"), what).toBe("no-referrer");
  expect(res.headers.get("cross-origin-opener-policy"), what).toBe("same-origin");
  expect(res.headers.get("permissions-policy"), what).toContain("camera=()");
  expect(res.headers.get("x-frame-options"), what).toBe(frame);
  const csp = res.headers.get("content-security-policy") ?? "";
  expect(csp, what).toContain("default-src 'self'");
  expect(csp, what).toContain("object-src 'none'");
  expect(csp, what).toContain(`frame-ancestors ${frame === "DENY" ? "'none'" : "'self'"}`);
}

describe("security headers on the built Worker", () => {
  it("are on pages, with / frameable by this origin only", async () => {
    const home = await send("/?theme=b-control-room", { headers: { cookie: viewer } });
    expect(home.status).toBe(200);
    expectSecure(home, "SAMEORIGIN", "/");
    // The page does carry inline scripts (Start's hydration data): the CSP must allow them.
    expect(await home.text()).toMatch(/<script(?![^>]*\bsrc=)[^>]*>[^<]+<\/script>/);

    const adminPage = await send("/admin", { headers: { cookie: admin } });
    expect(adminPage.status).toBe(200);
    expectSecure(adminPage, "DENY", "/admin");

    const missing = await send("/no-such-page", { headers: { cookie: viewer } });
    expect(missing.status).toBe(404);
    expectSecure(missing, "DENY", "Start 404");
  });

  it("are on the API, health, gate redirects and gate 404s", async () => {
    const cases: [string, RequestInit, number][] = [
      ["/api/health", {}, 200],
      ["/api/sites/demo/view", { headers: { cookie: viewer } }, 200],
      ["/api/sites/demo/nope", { headers: { cookie: viewer } }, 404],
      ["/?key=test-viewer-key", {}, 302],
      ["/", {}, 404],
      ["/api/sites/demo/view", {}, 404],
      ["/api/admin/sites/demo/config", { method: "PUT", headers: { cookie: admin } }, 403],
      ["/api/ingest/kuma", { method: "POST", body: "{}" }, 401],
    ];
    for (const [path, init, status] of cases) {
      const res = await send(path, init);
      const what = `${init.method ?? "GET"} ${path}`;
      expect(res.status, what).toBe(status);
      expectSecure(res, new URL(path, ORIGIN).pathname === "/" ? "SAMEORIGIN" : "DENY", what);
    }
  });
});

describe("rate limits on the built Worker", () => {
  it("answer 429 with retry-after and the security headers", async () => {
    const gate = refusing();
    const e = { ...baseEnv, GATE_RATE_LIMIT: gate } as Env;
    const guess = await send("/?key=guess", { headers: { "cf-connecting-ip": "client-a" } }, e);
    expect(guess.status).toBe(429);
    expect(guess.headers.get("retry-after")).toBe("60");
    expectSecure(guess, "SAMEORIGIN", "429");
    expect((await send("/api/sites/demo/view", {}, e)).status).toBe(429);
    expect(gate.asked).toEqual(["client-a", "unknown"]);

    const ingest = refusing();
    const post = await send(
      "/api/ingest/kuma",
      {
        method: "POST",
        body: "{}",
        headers: { "x-uptellis-key-id": "collector-1", "cf-connecting-ip": "client-b" },
      },
      { ...baseEnv, INGEST_RATE_LIMIT: ingest } as Env,
    );
    expect(post.status).toBe(429);
    expect(await post.json()).toEqual({ error: "rate_limited", message: "Too many requests" });
    expect(ingest.asked).toEqual(["collector-1|client-b"]);

    const writes = refusing();
    const put = await send(
      "/api/admin/sites/demo/config",
      { method: "PUT", body: "{}", headers: { cookie: admin, "sec-fetch-site": "same-origin" } },
      { ...baseEnv, ADMIN_WRITE_RATE_LIMIT: writes } as Env,
    );
    expect(put.status).toBe(429);
  });

  it("never apply to valid cookie page views, the API with a cookie or /api/health", async () => {
    const all = refusing();
    const e = {
      ...baseEnv,
      GATE_RATE_LIMIT: all,
      INGEST_RATE_LIMIT: all,
      ADMIN_WRITE_RATE_LIMIT: all,
    } as Env;
    expect((await send("/api/health", {}, e)).status).toBe(200);
    expect((await send("/", { headers: { cookie: viewer } }, e)).status).toBe(200);
    expect((await send("/api/sites/demo/view", { headers: { cookie: viewer } }, e)).status).toBe(200);
    expect((await send("/admin", { headers: { cookie: admin } }, e)).status).toBe(200);
    expect(all.asked).toEqual([]);
  });
});
