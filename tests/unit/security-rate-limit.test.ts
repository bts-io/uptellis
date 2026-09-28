import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RATE_LIMIT_BINDINGS } from "@/platform/cloudflare/bindings";
import { RATE_LIMITERS, type RateLimiter, type RateLimiterName } from "@/platform/types";
import { INGEST_HEADERS } from "@/shared/signing";
import { notFound } from "@/worker/middleware/auth-gate";
import {
  type Limiters,
  limitBeforeGates,
  limitGateRejection,
  RETRY_AFTER_S,
} from "@/worker/middleware/rate-limit";

/** A fake limiter: allows `limit` requests per key, records every key it was asked about. */
function fakeLimiter(limit: number): RateLimiter & { keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit(key) {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n <= limit;
    },
  };
}

/** A platform with a fake limiter per name. */
const fakes = (limit = 2) => {
  const limiters = { ingest: fakeLimiter(limit), gate: fakeLimiter(limit), adminWrite: fakeLimiter(limit) };
  return { ...limiters, rateLimiter: (name: RateLimiterName) => limiters[name] };
};

/** A platform without limiters. */
const none: Limiters = { rateLimiter: () => null };

// Client addresses are opaque strings to the limiter; names keep address literals out of the repo.
const req = (path: string, init: RequestInit = {}, client = "client-a") =>
  new Request(`https://status.example${path}`, {
    ...init,
    headers: { "cf-connecting-ip": client, ...(init.headers as Record<string, string> | undefined) },
  });

const ingest = (keyId: string, client = "client-a") =>
  req("/api/ingest/kuma", { method: "POST", body: "{}", headers: { [INGEST_HEADERS.keyId]: keyId } }, client);

async function statuses(env: Limiters, make: () => Request, n: number): Promise<(number | null)[]> {
  const out: (number | null)[] = [];
  for (let i = 0; i < n; i++) out.push((await limitBeforeGates(make(), env))?.status ?? null);
  return out;
}

describe("rate limits before the gates", () => {
  it("are a no-op without limiters", async () => {
    for (const r of [
      ingest("collector-1"),
      req("/api/auth/sign-in/email", { method: "POST" }),
      req("/api/admin/x", { method: "PUT" }),
    ]) {
      expect(await limitBeforeGates(r, none)).toBeNull();
    }
  });

  it("limit ingest per claimed key id and client IP, and answer 429 with retry-after", async () => {
    const env = fakes(2);
    expect(await statuses(env, () => ingest("collector-1"), 3)).toEqual([null, null, 429]);
    // Another producer, and the same key id from another address, have their own budgets.
    expect(await limitBeforeGates(ingest("facts-1"), env)).toBeNull();
    expect(await limitBeforeGates(ingest("collector-1", "client-b"), env)).toBeNull();
    expect(env.ingest.keys).toEqual([
      "collector-1|client-a",
      "collector-1|client-a",
      "collector-1|client-a",
      "facts-1|client-a",
      "collector-1|client-b",
    ]);

    const res = (await limitBeforeGates(ingest("collector-1"), env))!;
    expect(res.headers.get("retry-after")).toBe(String(RETRY_AFTER_S));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "rate_limited", message: "Too many requests" });
  });

  it("count every malformed key id under one name", async () => {
    const env = fakes(5);
    await limitBeforeGates(ingest("NOT A KEY"), env);
    await limitBeforeGates(req("/api/ingest/facts", { method: "POST" }), env);
    expect(env.ingest.keys).toEqual(["-|client-a", "-|client-a"]);
  });

  it("limit sign-in attempts per client IP, before the credential is checked", async () => {
    const env = fakes(3);
    const out: (number | null)[] = [];
    for (const path of [
      "/api/auth/sign-in/email",
      "/api/setup",
      "/api/invites/abc/accept",
      "/api/auth/sign-in/social",
    ]) {
      out.push((await limitBeforeGates(req(path, { method: "POST" }), env))?.status ?? null);
    }
    expect(out).toEqual([null, null, null, 429]);
    expect(await limitBeforeGates(req("/api/setup", { method: "POST" }, "client-b"), env)).toBeNull();
    // Reading the setup state, an invite or the session is not an attempt.
    for (const path of ["/api/setup", "/api/invites/abc", "/api/auth/get-session", "/api/me"]) {
      expect(await limitBeforeGates(req(path), env), path).toBeNull();
    }
    expect(await limitBeforeGates(req("/api/auth/sign-out", { method: "POST" }), env)).toBeNull();
  });

  it("limit admin writes per client IP, never admin reads", async () => {
    const env = fakes(2);
    const put = () => req("/api/admin/sites/demo/config", { method: "PUT", body: "{}" });
    expect(await statuses(env, put, 3)).toEqual([null, null, 429]);
    expect(await statuses(env, () => req("/api/admin/sites/demo/config"), 5)).toEqual(Array(5).fill(null));
    expect(await limitBeforeGates(req("/admin/x", { method: "POST" }, "client-b"), env)).toBeNull();
  });

  it("never count page views, API reads or /api/health", async () => {
    const env = fakes(0);
    for (const path of ["/", "/admin", "/api/health", "/api/sites/demo/view", "/?theme=b-control-room"]) {
      expect(await limitBeforeGates(req(path), env), path).toBeNull();
    }
    expect(await limitBeforeGates(req("/api/ingest/kuma"), env)).toBeNull();
    expect(env.gate.keys).toEqual([]);
    expect(env.adminWrite.keys).toEqual([]);
    expect(env.ingest.keys).toEqual([]);
  });
});

describe("rate limit on gate rejections", () => {
  it("counts 401, 403 and 404 per client IP and turns them into 429 past the limit", async () => {
    const env = fakes(3);
    const out: number[] = [];
    const denied = (status: number) => Response.json({ error: "x" }, { status });
    out.push((await limitGateRejection(req("/"), env, notFound("/"))).status);
    out.push((await limitGateRejection(req("/api/admin/users"), env, denied(401))).status);
    out.push((await limitGateRejection(req("/api/admin/users"), env, denied(403))).status);
    out.push((await limitGateRejection(req("/"), env, notFound("/"))).status);
    expect(out).toEqual([404, 401, 403, 429]);
    expect((await limitGateRejection(req("/", {}, "client-b"), env, notFound("/"))).status).toBe(404);
    const api = await limitGateRejection(req("/api/sites/demo/view"), env, notFound("/api/sites/demo/view"));
    expect(api.status).toBe(429);
    expect(await api.json()).toMatchObject({ error: "rate_limited" });
  });

  it("leaves other responses alone, and does not count ingest or a sign-in attempt twice", async () => {
    const env = fakes(0);
    const redirect = new Response(null, { status: 302 });
    expect(await limitGateRejection(req("/admin"), env, redirect)).toBe(redirect);
    const ok = new Response("ok");
    expect(await limitGateRejection(req("/"), env, ok)).toBe(ok);
    const refused = Response.json({ error: "unauthorized" }, { status: 401 });
    expect(await limitGateRejection(req("/api/auth/sign-in/email", { method: "POST" }), env, refused)).toBe(
      refused,
    );
    expect(await limitGateRejection(req("/api/ingest/kuma", { method: "POST" }), env, refused)).toBe(refused);
    expect(env.gate.keys).toEqual([]);
  });

  it("is a no-op without the limiter", async () => {
    const gated = notFound("/");
    expect(await limitGateRejection(req("/"), none, gated)).toBe(gated);
  });
});

describe("wrangler.jsonc rate limits", () => {
  // JSONC: drop whole-line comments, then parse the ratelimits array.
  const text = readFileSync(fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const block = /"ratelimits":\s*(\[[^\]]*\])/.exec(text)?.[1];

  it("binds one limiter per RATE_LIMITERS entry with its budget, over the period retry-after names", () => {
    expect(block).toBeDefined();
    const limits = JSON.parse(block!) as {
      name: string;
      namespace_id: string;
      simple: { limit: number; period: number };
    }[];
    const byName = Object.fromEntries(limits.map((l) => [l.name, l]));
    expect(Object.keys(byName).sort()).toEqual(Object.values(RATE_LIMIT_BINDINGS).sort());
    for (const [name, budget] of Object.entries(RATE_LIMITERS)) {
      const { simple } = byName[RATE_LIMIT_BINDINGS[name as RateLimiterName]]!;
      expect({ limit: simple.limit, periodS: simple.period }).toEqual(budget);
    }
    expect(new Set(limits.map((l) => l.namespace_id)).size).toBe(3);
    for (const l of limits) expect(l.simple.period).toBe(RETRY_AFTER_S);
    // The collector posts once a minute and backs off from 5 s after a failure; ingest must leave room.
    expect(byName.INGEST_RATE_LIMIT!.simple.limit).toBeGreaterThanOrEqual(30);
  });
});
