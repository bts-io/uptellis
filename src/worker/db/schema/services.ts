import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { CertSummary, ServiceKind, ServiceStatus } from "@/shared/model";
import { json, ms } from "./_helpers";

/** Current row per service (config and state together; upserted from each delta). */
export const services = sqliteTable(
  "services",
  {
    site: text().notNull(),
    id: text().notNull(),
    source: text().notNull(),
    externalId: text().notNull(),
    name: text().notNull(),
    kind: text().$type<ServiceKind>().notNull(),
    targetDisplay: text(),
    intervalS: integer(),
    method: text(),
    timeoutS: real(),
    status: text().$type<ServiceStatus>().notNull(),
    latencyMs: real(),
    avgLatencyMs: real(),
    uptime24h: real(),
    uptime30d: real(),
    cert: json<CertSummary>(),
    /** generatedAt of the delta that wrote this row; an older delta never overwrites a newer row. */
    observedAt: ms().notNull(),
  },
  (t) => [primaryKey({ columns: [t.site, t.id] })],
);
