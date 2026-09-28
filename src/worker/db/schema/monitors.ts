import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { CheckStatus } from "@/shared/monitors";
import { ms, updatedAt } from "./_helpers";

/**
 * Per (site, monitor, runner): the last applied check result and the run of `down` checks behind it
 * (`RunnerState` in src/shared/monitors/confirm.ts). `applyResults` (src/worker/monitors/apply.ts) reads
 * these to confirm a monitor across its runners and writes them after each accepted batch; a row never
 * moves backwards in time. Rows of removed monitors or runners are harmless (never read for confirmation).
 */
export const monitorRunners = sqliteTable(
  "monitor_runners",
  {
    site: text().notNull(),
    monitorId: text().notNull(),
    runner: text().notNull(),
    /** Epoch ms of the last applied result (`CheckResult.ts`). */
    lastTs: ms().notNull(),
    lastStatus: text().$type<CheckStatus>().notNull(),
    consecutiveDown: integer().notNull(),
    latencyMs: real(),
    message: text().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.site, t.monitorId, t.runner] })],
);
