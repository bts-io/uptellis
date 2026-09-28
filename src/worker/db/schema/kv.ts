import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { ms } from "./_helpers";

/**
 * The Docker runtime's key-value cache (`Platform.kv` over SQLite, src/platform/docker/kv.ts): JSON values
 * with an optional expiry, read as absent once expired and deleted by the daily prune. Unused on Cloudflare,
 * where KV holds these keys.
 */
export const kv = sqliteTable(
  "kv",
  {
    key: text().primaryKey(),
    value: text().notNull(),
    expiresAt: ms(),
  },
  (t) => [index("kv_expires_at_idx").on(t.expiresAt)],
);
