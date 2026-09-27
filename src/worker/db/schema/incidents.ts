import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { IncidentKind } from "@/shared/model";
import { ms, updatedAt } from "./_helpers";

/** Derived incidents (`down` per service, `stale` per source). Id is `incidentId(subject, startedAt)`. */
export const incidents = sqliteTable(
  "incidents",
  {
    site: text().notNull(),
    id: text().notNull(),
    kind: text().$type<IncidentKind>().notNull(),
    serviceId: text(),
    sourceId: text(),
    startedAt: ms().notNull(),
    endedAt: ms(),
    title: text().notNull(),
    notes: text(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.site, t.id] }),
    index("incidents_site_ended_idx").on(t.site, t.endedAt),
    index("incidents_site_started_idx").on(t.site, t.startedAt),
  ],
);
