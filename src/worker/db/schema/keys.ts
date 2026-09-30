import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, ms } from "./_helpers";

/**
 * Ingest signing keys kept in D1 (src/worker/engine/key-store.ts), one row per key id, bound to one site and
 * one source. Secrets are sealed (AES-GCM under `SOURCE_MASTER_KEY`), never stored in the clear.
 *
 * `currentSealed` null means the key has no current secret: a row left from an `INGEST_KEY_<ID>` env secret
 * of an earlier release, which are no longer read. Such a key verifies nothing until a rotation fills
 * `next`. `next` is the rotation slot: the first ingest that verifies with it promotes it to current.
 */
export const ingestKeys = sqliteTable("ingest_keys", {
  keyId: text().primaryKey(),
  site: text().notNull(),
  source: text().notNull(),
  currentSealed: text(),
  currentCreatedAt: ms(),
  nextSealed: text(),
  nextCreatedAt: ms(),
  lastUsedAt: ms(),
  createdAt: createdAt(),
});
