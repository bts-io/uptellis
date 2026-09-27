// Scrubbed fixtures for the normalized model (plan sections 1 and 2). Every entity uses the types and
// Zod schemas exported from `src/shared/model`; only `history` is fixture-only (see below).
import { z } from "zod";
import {
  Fact,
  Heartbeat,
  Incident,
  IsoTimestamp,
  Ratio,
  Service,
  ServiceId,
  ServiceStatus,
  Site,
  Source,
} from "../../src/shared/model";
import defaultFixture from "./data/default.json";
import incidentFixture from "./data/incident.json";
import staleFixture from "./data/stale.json";

export const FIXTURE_NAMES = ["default", "stale", "incident"] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

/**
 * One daily cell of the 90-day beat bar. Fixture-only: it has no model counterpart until Phase 1's
 * `heartbeat_5m` rollup, from which the view-model will derive the same cells.
 */
export const FixtureDayCell = z.object({
  /** UTC day, `YYYY-MM-DD`. */
  day: z.iso.date(),
  /** Worst state seen that day. */
  worst: ServiceStatus,
  /** Ratio 0..1, like the model's uptime fields. */
  uptime: Ratio,
  minutesDown: z.number().int().min(0).max(1440),
});
export type FixtureDayCell = z.infer<typeof FixtureDayCell>;

export const FixtureHistory = z.object({ serviceId: ServiceId, days: z.array(FixtureDayCell) });
export type FixtureHistory = z.infer<typeof FixtureHistory>;

/** A whole fixture: the model's entities for one site at `now`, plus the fixture-only `history`. */
export const FixtureModel = z.object({
  site: Site,
  sources: z.array(Source),
  services: z.array(Service),
  heartbeats: z.array(Heartbeat),
  history: z.array(FixtureHistory),
  incidents: z.array(Incident),
  facts: z.array(Fact),
  now: IsoTimestamp,
});
export type FixtureModel = z.infer<typeof FixtureModel>;

/** Parses a fixture strictly through the model's schemas (throws a ZodError on any drift). */
export function parseFixture(input: unknown): FixtureModel {
  return FixtureModel.parse(input);
}

const RAW: Record<FixtureName, unknown> = {
  default: defaultFixture,
  stale: staleFixture,
  incident: incidentFixture,
};

/** Returns a fresh deep copy, so a test can mutate it freely. */
export function loadFixture(name: FixtureName): FixtureModel {
  return structuredClone(RAW[name]) as FixtureModel;
}

/** The raw JSON of a fixture, for tests that validate it. */
export function rawFixture(name: FixtureName): unknown {
  return structuredClone(RAW[name]);
}
