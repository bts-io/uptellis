import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { bool, createdAt, ms } from "./_helpers";

/** Raw accepted ingest payloads for debugging, kept 7 days. */
export const snapshots = sqliteTable(
  "snapshots",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    site: text().notNull(),
    sourceId: text().notNull(),
    receivedAt: createdAt(),
    generatedAt: ms().notNull(),
    ok: bool().notNull(),
    body: text().notNull(),
  },
  (t) => [
    index("snapshots_site_source_received_idx").on(t.site, t.sourceId, t.receivedAt),
    index("snapshots_received_idx").on(t.receivedAt),
  ],
);

/** Seen ingest nonces (replay protection) until they expire. */
export const ingestNonces = sqliteTable(
  "ingest_nonces",
  {
    nonce: text().primaryKey(),
    expiresAt: ms().notNull(),
  },
  (t) => [index("ingest_nonces_expires_idx").on(t.expiresAt)],
);
