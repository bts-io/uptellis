import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createdAt, ms } from "./_helpers";

/**
 * Per (site, push monitor): its push token and the clock of its silent rule (src/worker/monitors/push.ts,
 * src/worker/routes/push.ts). The token itself is never stored: only its SHA-256 (hex), so a rotation
 * (a new hash) kills the old token at once. A row can exist without a token (`tokenHash` null): the silent
 * rule arms a push monitor before anyone created its URL.
 *
 * `watchSince` is when the silence clock started: the first time the every-minute job saw the monitor
 * enabled (null again while it is paused, so re-enabling restarts it). `configVersion` is the site config
 * version that last had this monitor as a push monitor; a newer version without it deletes the row (and the
 * token with it), so re-adding the same id needs a new URL.
 */
export const pushTokens = sqliteTable(
  "push_tokens",
  {
    site: text().notNull(),
    monitorId: text().notNull(),
    tokenHash: text(),
    tokenCreatedAt: ms(),
    lastPushAt: ms(),
    watchSince: ms(),
    configVersion: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.site, t.monitorId] }),
    uniqueIndex("push_tokens_token_hash_idx").on(t.tokenHash),
  ],
);
