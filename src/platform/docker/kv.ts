/**
 * `Platform.kv` in Docker: JSON values in the SQLite `kv` table (migration 0003). An expired entry reads
 * as absent and is deleted by the daily prune (src/worker/cron.ts). `cacheTtlS` is a Cloudflare edge
 * hint with no meaning on a local file, so it is ignored.
 */
import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { schema } from "@/worker/db";
import type { KeyValue } from "../types";

const { kv } = schema;

export function sqliteKeyValue(db: BunSQLiteDatabase<typeof schema>, now: () => number): KeyValue {
  return {
    async get<T>(key: string): Promise<T | null> {
      const row = db.select().from(kv).where(eq(kv.key, key)).get();
      if (!row || (row.expiresAt !== null && row.expiresAt <= now())) return null;
      return JSON.parse(row.value) as T;
    },
    async put(key, value, opts) {
      const values = {
        value: JSON.stringify(value),
        expiresAt: opts?.ttlS ? now() + opts.ttlS * 1000 : null,
      };
      db.insert(kv)
        .values({ key, ...values })
        .onConflictDoUpdate({ target: kv.key, set: values })
        .run();
    },
    async delete(key) {
      db.delete(kv).where(eq(kv.key, key)).run();
    },
  };
}
