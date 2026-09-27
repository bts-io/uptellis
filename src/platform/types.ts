/**
 * The platform contract (Phase 5, frozen): everything the app needs from where it runs. Uptellis runs on
 * Cloudflare (Workers, D1, KV, Cron Triggers, rate limit bindings) or in Docker (Bun, SQLite, a built-in
 * scheduler, in-memory rate limits). Only the adapters in `src/platform/<runtime>/` touch bindings, env or
 * the filesystem; everything else receives a `Platform`.
 */

import type { BatchItem } from "drizzle-orm/batch";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "@/worker/db/schema";

export type Runtime = "cloudflare" | "docker";

/** Drizzle over D1 (async) or `bun:sqlite` (sync); both are awaitable query builders over the same schema. */
export type AppDb = BaseSQLiteDatabase<"async" | "sync", unknown, typeof schema>;

/** A JSON key-value cache with expiry (KV on Cloudflare, a SQLite table in Docker). Values are JSON-serialisable. */
export interface KeyValue {
  get<T>(key: string, opts?: { cacheTtlS?: number }): Promise<T | null>;
  put(key: string, value: unknown, opts?: { ttlS?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** One fixed-window limiter; `limit` resolves false when the key is over its budget. */
export interface RateLimiter {
  limit(key: string): Promise<boolean>;
}
export const RATE_LIMITERS = {
  ingest: { limit: 60, periodS: 60 },
  gate: { limit: 20, periodS: 60 },
  adminWrite: { limit: 30, periodS: 60 },
} as const;
export type RateLimiterName = keyof typeof RATE_LIMITERS;

/** Secrets (never logged) and plain settings the app reads; adapters map them to env, files or bindings. */
export const SECRET_NAMES = [
  "BETTER_AUTH_SECRET",
  "SOURCE_MASTER_KEY",
  "DISCORD_WEBHOOK_URL",
  "GITHUB_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];
export const SETTING_NAMES = ["SITE_DEFAULT", "PUBLIC_URL", "GITHUB_CLIENT_ID", "GOOGLE_CLIENT_ID"] as const;
export type SettingName = (typeof SETTING_NAMES)[number];

/** Scheduled jobs; Cloudflare maps them to Cron Triggers, Docker runs them from its own scheduler. */
export const JOBS = {
  probes: "* * * * *",
  fiveMinute: "*/5 * * * *",
  daily: "17 3 * * *",
} as const;
export type JobName = keyof typeof JOBS;

export interface Platform {
  runtime: Runtime;
  db: AppDb;
  /**
   * Runs the statements atomically: a D1 batch on Cloudflare, one transaction on SQLite. The only way to
   * write several rows as a unit (no interactive transactions anywhere).
   */
  batch<T extends readonly [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]>(
    statements: T,
  ): Promise<unknown[]>;
  kv: KeyValue;
  /** Null when the runtime has no limiter configured for that name (then nothing is limited). */
  rateLimiter(name: RateLimiterName): RateLimiter | null;
  secret(name: SecretName): string | undefined;
  setting(name: SettingName): string | undefined;
  /** Keeps work alive after the response (Cloudflare `waitUntil`; Docker awaits it in the background). */
  waitUntil(work: Promise<unknown>): void;
  /** Wall clock in epoch milliseconds (injectable in tests). */
  now(): number;
}
