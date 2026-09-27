import { type SQL, sql } from "drizzle-orm";
import { toSnakeCase } from "drizzle-orm/casing";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

/** D1 binds at most 100 parameters per statement. */
export const MAX_BOUND_PARAMS = 100;

/** Rows per INSERT for a table with `columns` bound values per row. */
export const rowsPerInsert = (columns: number) => Math.max(1, Math.floor(MAX_BOUND_PARAMS / columns));

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Epoch milliseconds of an ISO timestamp. */
export const toMs = (iso: string): number => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error("Invalid timestamp");
  return t;
};

/** Canonical UTC ISO string: whole seconds print without a fraction (`2026-09-27T23:52:00Z`). */
export const toIso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");

/** Canonical form of an ISO timestamp (same instant, same spelling as `toIso`). */
export const canonicalIso = (iso: string): string => toIso(toMs(iso));

/**
 * `excluded.<column>` for an ON CONFLICT DO UPDATE set. The column name is derived the same way Drizzle's
 * `casing: "snake_case"` derives it, so the schema can keep its unnamed columns.
 */
export const excluded = (column: SQLiteColumn): SQL =>
  sql.raw(`excluded."${column.keyAsName ? toSnakeCase(column.name) : column.name}"`);
