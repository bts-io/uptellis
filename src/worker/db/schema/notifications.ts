import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, ms } from "./_helpers";

/**
 * Discord cards sent for `stale` incidents (src/worker/notify), one row per incident transition. The row is
 * claimed (`pending`) before the card is posted, so a retried cron or a concurrent ingest never posts the
 * same transition twice; `status` then records `sent` or `failed` with a short `error` code.
 */
export const notifications = sqliteTable(
  "notifications",
  {
    site: text().notNull(),
    incidentId: text().notNull(),
    kind: text().$type<"open" | "resolve">().notNull(),
    status: text().$type<"pending" | "sent" | "failed">().notNull(),
    sentAt: ms(),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.site, t.incidentId, t.kind] })],
);
