/**
 * The Docker adapter: a `Platform` over one SQLite file through `bun:sqlite` (WAL mode, the same
 * `migrations/` as D1 applied at startup), the `kv` table as the cache, in-memory fixed-window rate
 * limits, secrets and settings from env vars or `<NAME>_FILE`, and a `waitUntil` that tracks background
 * work so shutdown can wait for it. `batch` runs its statements in one SQLite transaction.
 */
import { Database } from "bun:sqlite";
import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createBunTransport } from "@/checks/bun-transport";
import { schema } from "@/worker/db";
import { type Platform, SECRET_NAMES, SETTING_NAMES, type SecretName, type SettingName } from "../types";
import { type EnvSource, readEnv } from "./env";
import { sqliteKeyValue } from "./kv";
import { memoryLimiters } from "./rate-limit";

export interface DockerPlatformOptions {
  /** The SQLite file (created when missing), or ":memory:". */
  databasePath: string;
  /** The folder holding the Drizzle migrations and `meta/_journal.json`. */
  migrationsFolder: string;
  /** Where secrets and settings come from (`process.env` in the server). */
  env: EnvSource;
  /** Wall clock in epoch milliseconds (tests pin it). */
  now?: () => number;
}

export interface DockerPlatform extends Platform {
  runtime: "docker";
  /** Resolves once every `waitUntil` so far (and the work those started) has settled. */
  drain(): Promise<void>;
  /** Closes the database; call after `drain`. */
  close(): void;
}

/** A prepared statement of the synchronous driver, as Drizzle builds it for `execute`. */
type SyncPrepared = { executeMethod: "run" | "all" | "get" | "values" } & Record<
  "run" | "all" | "get" | "values",
  () => unknown
>;

/** Runs one batch item now, the way Drizzle would run it alone: rows for selects and `returning`, else the run result. */
function runNow(item: BatchItem<"sqlite">): unknown {
  const prepared = (item as unknown as { _prepare(): SyncPrepared })._prepare();
  return prepared[prepared.executeMethod]();
}

/** Opens the database, applies pending migrations and builds the platform. */
export function createDockerPlatform(opts: DockerPlatformOptions): DockerPlatform {
  const now = opts.now ?? (() => Date.now());
  const sqlite = new Database(opts.databasePath, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA synchronous = NORMAL");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  const db = drizzle({ client: sqlite, schema, casing: "snake_case" });
  migrate(db, { migrationsFolder: opts.migrationsFolder });

  const secrets = new Map<SecretName, string | undefined>(SECRET_NAMES.map((n) => [n, readEnv(opts.env, n)]));
  const settings = new Map<SettingName, string | undefined>(
    SETTING_NAMES.map((n) => [n, readEnv(opts.env, n)]),
  );
  const limiters = memoryLimiters(now);
  const pending = new Set<Promise<unknown>>();

  return {
    runtime: "docker",
    db,
    batch: async (statements) => sqlite.transaction(() => statements.map(runNow))(),
    kv: sqliteKeyValue(db, now),
    rateLimiter: (name) => limiters[name],
    secret: (name) => secrets.get(name),
    setting: (name) => settings.get(name),
    waitUntil(work) {
      const tracked: Promise<unknown> = work
        .catch((err: unknown) =>
          console.error(
            JSON.stringify({ evt: "background", name: err instanceof Error ? err.name : "unknown" }),
          ),
        )
        .finally(() => pending.delete(tracked));
      pending.add(tracked);
    },
    now,
    checkTransport: createBunTransport(),
    async drain() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
    close: () => sqlite.close(),
  };
}
