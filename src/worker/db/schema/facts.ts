import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { FactSeverity, FactValueType } from "@/shared/model";
import { bool, ms } from "./_helpers";

/**
 * Current value per fact and source: two sources reporting the same key (the two nodes of a failover pair)
 * each keep their own row, and the view decides which one it shows. The tagged model value is stored as `valueType` plus one of the value columns:
 * `number` in valueNum, `boolean` in valueBool, `string` and `timestamp` (ISO) in valueText.
 */
export const facts = sqliteTable(
  "facts",
  {
    site: text().notNull(),
    grp: text().notNull(),
    key: text().notNull(),
    source: text().notNull(),
    valueType: text().$type<FactValueType>().notNull(),
    valueText: text(),
    valueNum: real(),
    valueBool: bool(),
    unit: text(),
    severity: text().$type<FactSeverity>(),
    observedAt: ms().notNull(),
    freshForS: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.site, t.source, t.grp, t.key] })],
);

/** Numeric fact history (lag, disk) per source, kept 90 days. */
export const factSamples = sqliteTable(
  "fact_samples",
  {
    site: text().notNull(),
    source: text().notNull(),
    grp: text().notNull(),
    key: text().notNull(),
    ts: ms().notNull(),
    value: real().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.site, t.source, t.grp, t.key, t.ts] }),
    index("fact_samples_ts_idx").on(t.ts),
  ],
);
