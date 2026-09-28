/**
 * The Cloudflare adapter: a `Platform` over the Worker's bindings. D1 through Drizzle, the KV namespace
 * `CACHE`, the three Workers Rate Limiting bindings, secrets and settings from env, and the request's or
 * cron's `ctx.waitUntil`. Built per request (cheap wrappers only).
 */
import { drizzle } from "drizzle-orm/d1";
import type { AppBindings } from "@/worker/app-env";
import { schema } from "@/worker/db";
import { envIngestKeys } from "@/worker/ingest/keys";
import type { KeyValue, Platform, RateLimiter, SecretName, SettingName } from "../types";
import { RATE_LIMIT_BINDINGS } from "./bindings";

/** Drizzle over a D1 binding, with the app's schema and column casing. */
export function createD1Db(d1: D1Database) {
  return drizzle(d1, { schema, casing: "snake_case" });
}

/** KV's shortest edge cache and shortest expiry. */
const KV_MIN_TTL_S = 60;
const KV_MIN_CACHE_TTL_S = 30;

function kvStore(kv: KVNamespace): KeyValue {
  return {
    get: <T>(key: string, opts?: { cacheTtlS?: number }) =>
      kv.get<T>(key, {
        type: "json",
        ...(opts?.cacheTtlS ? { cacheTtl: Math.max(opts.cacheTtlS, KV_MIN_CACHE_TTL_S) } : {}),
      }),
    put: (key, value, opts) =>
      kv.put(
        key,
        JSON.stringify(value),
        opts?.ttlS ? { expirationTtl: Math.max(opts.ttlS, KV_MIN_TTL_S) } : undefined,
      ),
    delete: (key) => kv.delete(key),
  };
}

/** A string env value, empty as unset. */
const envString = (env: Env, name: string): string | undefined => {
  const v = (env as unknown as Record<string, unknown>)[name];
  return typeof v === "string" && v.length > 0 ? v : undefined;
};

export function createCloudflarePlatform(env: Env, ctx: Pick<ExecutionContext, "waitUntil">): Platform {
  const d1 = createD1Db(env.DB);
  return {
    runtime: "cloudflare",
    db: d1,
    batch: (statements) => d1.batch(statements) as Promise<unknown[]>,
    kv: kvStore(env.CACHE),
    rateLimiter(name): RateLimiter | null {
      const binding = (env as Partial<Env>)[RATE_LIMIT_BINDINGS[name]];
      if (!binding) return null;
      return { limit: async (key) => (await binding.limit({ key })).success };
    },
    secret: (name: SecretName) => envString(env, name),
    setting: (name: SettingName) => envString(env, name),
    waitUntil: (work) => ctx.waitUntil(work),
    now: () => Date.now(),
  };
}

/** What the API receives per request on Cloudflare: the platform and the Worker's `INGEST_KEY_*` secrets. */
export function cloudflareBindings(env: Env, ctx: Pick<ExecutionContext, "waitUntil">): AppBindings {
  return { platform: createCloudflarePlatform(env, ctx), envIngestKeys: envIngestKeys(env) };
}
