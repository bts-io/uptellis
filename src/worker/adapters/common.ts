/** Small helpers shared by the adapters (pure). */
import type { Service } from "@/shared/model";

/** ISO timestamp without milliseconds, e.g. `2026-09-27T23:58:00Z`. */
export const isoSeconds = (t: Date | number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The earlier of `generatedAt` and `now`: a producer clock running ahead never makes a source look fresher. */
export function seenAt(generatedAt: string, now: Date): string {
  return Date.parse(generatedAt) > now.getTime() ? isoSeconds(now) : generatedAt;
}

export const byTs = (a: { ts: string }, b: { ts: string }) => Date.parse(a.ts) - Date.parse(b.ts);

/** Optional adapter context: the services' rows before this delta, for fields a payload does not repeat. */
export interface AdapterContext {
  previous?: readonly Service[];
}

export const previousById = (ctx?: AdapterContext) => new Map((ctx?.previous ?? []).map((s) => [s.id, s]));
