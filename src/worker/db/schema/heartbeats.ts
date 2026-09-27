import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ServiceStatus } from "@/shared/model";
import { bool, ms } from "./_helpers";

/** Raw heartbeats, kept 26 h (pruned daily). Idempotent on (site, service, ts). */
export const heartbeats = sqliteTable(
  "heartbeats",
  {
    site: text().notNull(),
    serviceId: text().notNull(),
    ts: ms().notNull(),
    status: text().$type<ServiceStatus>().notNull(),
    latencyMs: real(),
    message: text(),
    important: bool().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.site, t.serviceId, t.ts] }), index("heartbeats_ts_idx").on(t.ts)],
);

/** 5-minute rollups of `heartbeats`, kept 90 days. `bucket` is the window start in epoch ms. */
export const heartbeat5m = sqliteTable(
  "heartbeat_5m",
  {
    site: text().notNull(),
    serviceId: text().notNull(),
    bucket: ms().notNull(),
    total: integer().notNull(),
    up: integer().notNull(),
    down: integer().notNull(),
    maint: integer().notNull(),
    pending: integer().notNull(),
    pingAvg: real(),
    pingMax: real(),
  },
  (t) => [
    primaryKey({ columns: [t.site, t.serviceId, t.bucket] }),
    index("heartbeat_5m_bucket_idx").on(t.bucket),
  ],
);
