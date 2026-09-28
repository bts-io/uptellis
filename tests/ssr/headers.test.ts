import { beforeAll, describe, expect, it } from "vitest";
import { baseEnv, ORIGIN, ownerCookie, send } from "./built";
import { seed } from "./seed";

// Security headers and rate limits on the built Worker entry (dist/server), called directly so the env can
// carry fake rate limit bindings.
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

let admin = "";

beforeAll(async () => {
  await seed("default");
  admin = await ownerCookie();
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
    const home = await send("/?theme=b-control-room");
    expect(home.status).toBe(200);
    expectSecure(home, "SAMEORIGIN", "/");
    // The page does carry inline scripts (Start's hydration data): the CSP must allow them.
    expect(await home.text()).toMatch(/<script(?![^>]*\bsrc=)[^>]*>[^<]+<\/script>/);

    const adminPage = await send("/admin", { headers: { cookie: admin } });
    expect(adminPage.status).toBe(200);
    expectSecure(adminPage, "DENY", "/admin");

    const missing = await send("/no-such-page");
    expect(missing.status).toBe(404);
    expectSecure(missing, "DENY", "Start 404");
  });

  it("are on the API, health, gate redirects and refusals", async () => {
    const cases: [string, RequestInit, number][] = [
      ["/api/health", {}, 200],
      ["/api/sites/demo/view", {}, 200],
      ["/api/sites/demo/nope", {}, 404],
      ["/admin", {}, 302],
      ["/api/sites/nope/view", {}, 404],
      ["/api/admin/sites/demo/config", {}, 401],
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
    const guess = await send(
      "/api/auth/sign-in/email",
      { method: "POST", body: "{}", headers: { "cf-connecting-ip": "client-a" } },
      e,
    );
    expect(guess.status).toBe(429);
    expect(guess.headers.get("retry-after")).toBe("60");
    expectSecure(guess, "DENY", "429");
    expect((await send("/api/sites/nope/view", {}, e)).status).toBe(429);
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

  it("never apply to allowed page views, API reads or /api/health", async () => {
    const all = refusing();
    const e = {
      ...baseEnv,
      GATE_RATE_LIMIT: all,
      INGEST_RATE_LIMIT: all,
      ADMIN_WRITE_RATE_LIMIT: all,
    } as Env;
    expect((await send("/api/health", {}, e)).status).toBe(200);
    expect((await send("/", {}, e)).status).toBe(200);
    expect((await send("/api/sites/demo/view", {}, e)).status).toBe(200);
    expect((await send("/admin", { headers: { cookie: admin } }, e)).status).toBe(200);
    expect(all.asked).toEqual([]);
  });
});
