import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SourceKind } from "@/shared/model";
import { ms, updatedAt } from "./_helpers";

/** A producer of data for a site (`kuma:watch-1`, `facts:app-1`). Touched on every accepted ingest. */
export const sources = sqliteTable(
  "sources",
  {
    site: text().notNull(),
    id: text().notNull(),
    kind: text().$type<SourceKind>().notNull(),
    expectedIntervalS: integer().notNull(),
    lastSeenAt: ms(),
    lastOkAt: ms(),
    lastError: text(),
    /** Ingest signing key id and its sealed secret (set by the ingest/admin side, never returned by reads). */
    keyId: text(),
    secretSealed: text(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.site, t.id] }), index("sources_key_id_idx").on(t.keyId)],
);
