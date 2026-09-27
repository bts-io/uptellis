import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INGEST_HEADERS } from "@/shared/signing";
import {
  type Limiter,
  limitBeforeGates,
  limitGateRejection,
  type RateLimitEnv,
  RETRY_AFTER_S,
} from "@/worker/middleware/rate-limit";
import { notFound } from "@/worker/middleware/viewer-key";

/** A fake binding: allows `limit` requests per key, records every key it was asked about. */
function fakeLimiter(limit: number): Limiter & { keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    },
  };
}

const fakes = (limit = 2) => ({
  INGEST_RATE_LIMIT: fakeLimiter(limit),
  GATE_RATE_LIMIT: fakeLimiter(limit),
  ADMIN_WRITE_RATE_LIMIT: fakeLimiter(limit),
});

// Client addresses are opaque strings to the limiter; names keep address literals out of the repo.
const req = (path: string, init: RequestInit = {}, client = "client-a") =>
  new Request(`https://status.example${path}`, {
    ...init,
    headers: { "cf-connecting-ip": client, ...(init.headers as Record<string, string> | undefined) },
  });

const ingest = (keyId: string, client = "client-a") =>
  req("/api/ingest/kuma", { method: "POST", body: "{}", headers: { [INGEST_HEADERS.keyId]: keyId } }, client);

async function statuses(env: RateLimitEnv, make: () => Request, n: number): Promise<(number | null)[]> {
  const out: (number | null)[] = [];
  for (let i = 0; i < n; i++) out.push((await limitBeforeGates(make(), env))?.status ?? null);
  return out;
}

describe("rate limits before the gates", () => {
  it("are a no-op without bindings", async () => {
    for (const r of [ingest("collector-1"), req("/?key=guess"), req("/api/admin/x", { method: "PUT" })]) {
      expect(await limitBeforeGates(r, {})).toBeNull();
    }
  });

  it("limit ingest per claimed key id and client IP, and answer 429 with retry-after", async () => {
    const env = fakes(2);
    expect(await statuses(env, () => ingest("collector-1"), 3)).toEqual([null, null, 429]);
    // Another producer, and the same key id from another address, have their own budgets.
    expect(await limitBeforeGates(ingest("facts-1"), env)).toBeNull();
    expect(await limitBeforeGates(ingest("collector-1", "client-b"), env)).toBeNull();
    expect(env.INGEST_RATE_LIMIT.keys).toEqual([
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
    expect(env.INGEST_RATE_LIMIT.keys).toEqual(["-|client-a", "-|client-a"]);
  });

  it("limit ?key= and ?admin= per client IP on any path, before the key is compared", async () => {
    const env = fakes(2);
    const out: (number | null)[] = [];
    for (const path of ["/?key=a", "/admin?admin=b", "/api/sites/demo/view?key=c"]) {
      out.push((await limitBeforeGates(req(path), env))?.status ?? null);
    }
    expect(out).toEqual([null, null, 429]);
    expect(await limitBeforeGates(req("/?key=a", {}, "client-b"), env)).toBeNull();
    const page = (await limitBeforeGates(req("/?key=a"), env))!;
    expect(page.headers.get("content-type")).toBe("text/plain");
    expect(await page.text()).toBe("Too many requests");
  });

  it("limit admin writes per client IP, never admin reads", async () => {
    const env = fakes(2);
    const put = () => req("/api/admin/sites/demo/config", { method: "PUT", body: "{}" });
    expect(await statuses(env, put, 3)).toEqual([null, null, 429]);
    expect(await statuses(env, () => req("/api/admin/sites/demo/config"), 5)).toEqual(Array(5).fill(null));
    expect(await limitBeforeGates(req("/admin/x", { method: "POST" }, "client-b"), env)).toBeNull();
  });

  it("never count page views, the API with a cookie or /api/health", async () => {
    const env = fakes(0);
    for (const path of ["/", "/admin", "/api/health", "/api/sites/demo/view", "/?theme=b-control-room"]) {
      expect(
        await limitBeforeGates(req(path, { headers: { cookie: "uptellis_view=1.x" } }), env),
        path,
      ).toBeNull();
    }
    expect(await limitBeforeGates(req("/api/ingest/kuma"), env)).toBeNull();
    expect(env.GATE_RATE_LIMIT.keys).toEqual([]);
    expect(env.ADMIN_WRITE_RATE_LIMIT.keys).toEqual([]);
    expect(env.INGEST_RATE_LIMIT.keys).toEqual([]);
  });
});

describe("rate limit on gate rejections", () => {
  it("counts 404s per client IP and turns them into 429 past the limit", async () => {
    const env = fakes(2);
    const out: number[] = [];
    for (let i = 0; i < 3; i++) out.push((await limitGateRejection(req("/"), env, notFound("/"))).status);
    expect(out).toEqual([404, 404, 429]);
    expect((await limitGateRejection(req("/", {}, "client-b"), env, notFound("/"))).status).toBe(404);
    const api = await limitGateRejection(req("/api/sites/demo/view"), env, notFound("/api/sites/demo/view"));
    expect(api.status).toBe(429);
    expect(await api.json()).toMatchObject({ error: "rate_limited" });
  });

  it("leaves other gate responses alone and does not count a key request twice", async () => {
    const env = fakes(0);
    const redirect = new Response(null, { status: 302 });
    expect(await limitGateRejection(req("/?key=a"), env, redirect)).toBe(redirect);
    const forbidden = new Response(null, { status: 403 });
    expect(await limitGateRejection(req("/api/admin/x", { method: "PUT" }), env, forbidden)).toBe(forbidden);
    const wrongKey = notFound("/");
    expect(await limitGateRejection(req("/?key=wrong"), env, wrongKey)).toBe(wrongKey);
    expect(env.GATE_RATE_LIMIT.keys).toEqual([]);
  });

  it("is a no-op without the binding", async () => {
    const gated = notFound("/");
    expect(await limitGateRejection(req("/"), {}, gated)).toBe(gated);
  });
});

describe("wrangler.jsonc rate limits", () => {
  // JSONC: drop whole-line comments, then parse the ratelimits array.
  const text = readFileSync(fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const block = /"ratelimits":\s*(\[[^\]]*\])/.exec(text)?.[1];

  it("binds the three limiters the middleware reads, over the period retry-after names", () => {
    expect(block).toBeDefined();
    const limits = JSON.parse(block!) as {
      name: string;
      namespace_id: string;
      simple: { limit: number; period: number };
    }[];
    const byName = Object.fromEntries(limits.map((l) => [l.name, l]));
    expect(Object.keys(byName).sort()).toEqual([
      "ADMIN_WRITE_RATE_LIMIT",
      "GATE_RATE_LIMIT",
      "INGEST_RATE_LIMIT",
    ] satisfies (keyof RateLimitEnv)[]);
    expect(new Set(limits.map((l) => l.namespace_id)).size).toBe(3);
    for (const l of limits) expect(l.simple.period).toBe(RETRY_AFTER_S);
    // The collector posts once a minute and backs off from 5 s after a failure; ingest must leave room.
    expect(byName.INGEST_RATE_LIMIT!.simple.limit).toBeGreaterThanOrEqual(30);
  });
});
