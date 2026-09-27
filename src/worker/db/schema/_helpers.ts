import { sql } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";

// Column names come from the property names through Drizzle's `casing: "snake_case"` (db/index.ts and
// drizzle.config.ts). Every model timestamp is stored as integer epoch milliseconds (UTC); the mappers in
// db/rows.ts turn them back into ISO strings.
export const ms = () => integer();
export const createdAt = () =>
  integer().notNull().default(sql`(cast(unixepoch('subsec') * 1000 as integer))`);
export const updatedAt = () =>
  integer().notNull().default(sql`(cast(unixepoch('subsec') * 1000 as integer))`);
export const bool = () => integer({ mode: "boolean" });
export const json = <T>() => text({ mode: "json" }).$type<T>();
