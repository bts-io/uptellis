/**
 * Where runner states live (`RunnerState` per site, monitor and runner; the `monitor_runners` table). The
 * interface keeps `applyResults` testable over memory; `SqlRunnerStates` is the D1 / SQLite implementation.
 *
 * Writes are one `platform.batch` per call and never move a row backwards: an upsert only replaces a row
 * whose `lastTs` is older, so two overlapping calls for the same runner keep the newer state.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Platform } from "@/platform/types";
import type { RunnerState } from "@/shared/monitors";
import { schema } from "@/worker/db";
import { chunk, excluded, rowsPerInsert } from "@/worker/db/util";

const { monitorRunners } = schema;

/** One runner's state of one monitor. */
export interface MonitorRunnerState {
  monitorId: string;
  state: RunnerState;
}

export interface RunnerStateStore {
  /** Every runner state of the site's `monitorIds`, grouped by monitor id. */
  load(site: string, monitorIds: readonly string[]): Promise<Map<string, RunnerState[]>>;
  /** Writes the states atomically; a stored state newer than the one given is kept. */
  save(site: string, states: readonly MonitorRunnerState[]): Promise<void>;
}

// Rows per INSERT under D1's 100 bound parameters (9 columns inserted).
const STATE_ROWS = rowsPerInsert(9);
// Monitor ids per `in (...)` list, with the site as one more parameter.
const ID_LIST = 90;

export class SqlRunnerStates implements RunnerStateStore {
  constructor(private readonly platform: Pick<Platform, "db" | "batch">) {}

  async load(site: string, monitorIds: readonly string[]): Promise<Map<string, RunnerState[]>> {
    const out = new Map<string, RunnerState[]>();
    for (const ids of chunk(monitorIds, ID_LIST)) {
      const rows = await this.platform.db
        .select()
        .from(monitorRunners)
        .where(and(eq(monitorRunners.site, site), inArray(monitorRunners.monitorId, ids)));
      for (const r of rows) {
        const list = out.get(r.monitorId) ?? [];
        list.push({
          runner: r.runner,
          lastTs: r.lastTs,
          lastStatus: r.lastStatus,
          consecutiveDown: r.consecutiveDown,
          latencyMs: r.latencyMs,
          message: r.message,
        });
        out.set(r.monitorId, list);
      }
    }
    return out;
  }

  async save(site: string, states: readonly MonitorRunnerState[]): Promise<void> {
    const now = Date.now();
    const { db } = this.platform;
    const stmts: BatchItem<"sqlite">[] = chunk(states, STATE_ROWS).map((part) =>
      db
        .insert(monitorRunners)
        .values(
          part.map(({ monitorId, state: s }) => ({
            site,
            monitorId,
            runner: s.runner,
            lastTs: s.lastTs,
            lastStatus: s.lastStatus,
            consecutiveDown: s.consecutiveDown,
            latencyMs: s.latencyMs,
            message: s.message,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [monitorRunners.site, monitorRunners.monitorId, monitorRunners.runner],
          set: Object.fromEntries(
            (["lastTs", "lastStatus", "consecutiveDown", "latencyMs", "message", "updatedAt"] as const).map(
              (k) => [k, excluded(monitorRunners[k])],
            ),
          ),
          setWhere: sql`${excluded(monitorRunners.lastTs)} > ${monitorRunners.lastTs}`,
        }),
    );
    const [first, ...others] = stmts;
    if (first) await this.platform.batch([first, ...others]);
  }
}
