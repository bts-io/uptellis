import { z } from "zod";
import { IsoTimestamp, SiteSlug, SourceId } from "./common";
import { safeDisplay } from "./safety";

export const FACT_VALUE_TYPES = ["number", "string", "boolean", "timestamp"] as const;
export const FactValueType = z.enum(FACT_VALUE_TYPES);
export type FactValueType = z.infer<typeof FactValueType>;

/** Typed fact value. String values are shown in the UI, so they are display-safe. */
export const FactValue = z.discriminatedUnion("type", [
  z.object({ type: z.literal("number"), value: z.number() }),
  z.object({ type: z.literal("string"), value: safeDisplay(500) }),
  z.object({ type: z.literal("boolean"), value: z.boolean() }),
  z.object({ type: z.literal("timestamp"), value: IsoTimestamp }),
]);
export type FactValue = z.infer<typeof FactValue>;

export const FACT_SEVERITIES = ["ok", "warn", "crit", "info"] as const;
export const FactSeverity = z.enum(FACT_SEVERITIES);
export type FactSeverity = z.infer<typeof FactSeverity>;

/** e.g. `replication`, `backup`, `fence`. */
export const FactGroup = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
export type FactGroup = z.infer<typeof FactGroup>;

/** e.g. `lagSeconds`, `lastAt`, `disk.percent`. */
export const FactKey = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/);
export type FactKey = z.infer<typeof FactKey>;

export const FactUnit = z.string().regex(/^[A-Za-z0-9%/._-]{1,16}$/);

export const Fact = z.object({
  site: SiteSlug,
  source: SourceId,
  group: FactGroup,
  key: FactKey,
  value: FactValue,
  unit: FactUnit.nullable(),
  severity: FactSeverity.nullable(),
  observedAt: IsoTimestamp,
  /** Seconds after observedAt during which the value counts as current. */
  freshForS: z.number().int().positive(),
});
export type Fact = z.infer<typeof Fact>;

/**
 * Builds a typed value from a raw JSON scalar. Without a type hint, numbers, booleans and strings map to
 * themselves (strings are never guessed to be timestamps). Returns null when the value does not fit.
 */
export function factValueFrom(raw: number | string | boolean, type?: FactValueType): FactValue | null {
  const t: FactValueType =
    type ?? (typeof raw === "number" ? "number" : typeof raw === "boolean" ? "boolean" : "string");
  const parsed = FactValue.safeParse({ type: t, value: raw });
  return parsed.success ? parsed.data : null;
}
