import { z } from "zod";
import { IsoTimestamp, SiteSlug, SourceId, SourceKind, sourceKindOf } from "./common";

export const Source = z
  .object({
    id: SourceId,
    site: SiteSlug,
    kind: SourceKind,
    expectedIntervalS: z.number().int().positive(),
    lastSeenAt: IsoTimestamp.nullable(),
    lastOkAt: IsoTimestamp.nullable(),
  })
  .refine((s) => sourceKindOf(s.id) === s.kind, {
    message: "Source id prefix must match its kind",
    path: ["id"],
  });
export type Source = z.infer<typeof Source>;

export const SOURCE_FRESHNESS = ["fresh", "aging", "stale", "empty"] as const;
export type SourceFreshness = (typeof SOURCE_FRESHNESS)[number];

/** Multiples of the expected interval: fresh below 2x, aging up to and including 5x, stale beyond. */
export const FRESHNESS_FACTORS = { aging: 2, stale: 5 } as const;

const toMs = (t: Date | number | string) =>
  t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t);

/** Seconds since the source was last seen, or null if never. Clock skew into the future counts as 0. */
export function sourceAgeS(source: Pick<Source, "lastSeenAt">, now: Date | number): number | null {
  if (!source.lastSeenAt) return null;
  return Math.max(0, (toMs(now) - toMs(source.lastSeenAt)) / 1000);
}

/** Pure staleness of a source at `now` (Date or epoch milliseconds). */
export function sourceFreshness(
  source: Pick<Source, "lastSeenAt" | "expectedIntervalS">,
  now: Date | number,
): SourceFreshness {
  const age = sourceAgeS(source, now);
  if (age === null || Number.isNaN(age)) return "empty";
  if (age < FRESHNESS_FACTORS.aging * source.expectedIntervalS) return "fresh";
  if (age <= FRESHNESS_FACTORS.stale * source.expectedIntervalS) return "aging";
  return "stale";
}
