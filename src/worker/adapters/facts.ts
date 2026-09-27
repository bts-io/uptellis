/** Facts adapter: a `FactsPayload` (e.g. push-facts.sh on app-1) -> `ModelDelta` of Fact rows (pure). */
import { type Fact, factValueFrom, type SourceId } from "@/shared/model";
import type { FactsPayload, IngestFact, ModelDelta } from "@/shared/schemas";
import { issue, PayloadRejected } from "../ingest/issues";
import { seenAt } from "./common";

export function toFact(
  f: IngestFact & { group: string },
  source: SourceId,
  site: string,
  generatedAt: string,
  path: PropertyKey[],
): Fact {
  const value = factValueFrom(f.value, f.type);
  // The schema already refines value against type; this only guards a drift between the two.
  if (!value) throw new PayloadRejected([issue([...path, "value"], "Value does not match its type")]);
  return {
    site,
    source,
    group: f.group,
    key: f.key,
    value,
    unit: f.unit ?? null,
    severity: f.severity ?? null,
    observedAt: f.observedAt ?? generatedAt,
    freshForS: f.freshForS,
  };
}

export function normalizeFacts(p: FactsPayload, source: SourceId, site: string, now: Date): ModelDelta {
  const facts = p.groups.flatMap((g, gi) =>
    g.facts.map((f, fi) =>
      toFact({ ...f, group: g.group }, source, site, p.generatedAt, ["groups", gi, "facts", fi]),
    ),
  );
  return {
    site,
    generatedAt: p.generatedAt,
    source: { sourceId: source, seenAt: seenAt(p.generatedAt, now), ok: true, error: null },
    services: [],
    heartbeats: [],
    facts,
  };
}

export { normalizeFacts as normalize };
