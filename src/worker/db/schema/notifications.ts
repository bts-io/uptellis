import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { bool, createdAt, ms } from "./_helpers";

/**
 * The delivery log of the notifier (src/worker/notify): one row per incident transition and channel. The
 * row is claimed (`pending`) before the channel is sent to, so a retried cron or a concurrent ingest never
 * sends the same transition to the same channel twice; `status` then records `sent` or `failed` with a
 * short `error` code (never a URL, token, address or response body). A `failed` row that is `retryable` is
 * retried by the five-minute job for up to an hour after it was claimed. Rows from before channels (0.3.x)
 * belong to the historical Discord channel (`channel` = `discord`).
 */
export const notifications = sqliteTable(
  "notifications",
  {
    site: text().notNull(),
    incidentId: text().notNull(),
    kind: text().$type<"open" | "resolve">().notNull(),
    /** The channel id (`ChannelConfig.id`, `discord` for the historical Discord channel). */
    channel: text().notNull().default("discord"),
    status: text().$type<"pending" | "sent" | "failed">().notNull(),
    sentAt: ms(),
    error: text(),
    /** Send attempts so far (in-request retries and the five-minute job's). */
    attempts: integer().notNull().default(1),
    /** A failure the five-minute job may retry (429, 5xx, network); false once final. */
    retryable: bool().notNull().default(false),
    lastAttemptAt: ms(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.site, t.incidentId, t.kind, t.channel] })],
);
