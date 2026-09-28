/**
 * Phase 1 interface contract between the `storage` stream (D1 implementation) and the `ingest` stream
 * (adapters and routes, tested against an in-memory implementation). Changing a signature here needs
 * the lead: both streams code against it.
 */
import type { Incident, Service, SourceKind } from "@/shared/model";
import type { ModelDelta } from "@/shared/schemas";
import type { ServiceDays, SiteModel } from "@/shared/view/input";

export type { ServiceDays, SiteModel };

export const RECENT_BEATS = 48;

export interface ApplyResult {
  servicesUpserted: number;
  heartbeatsInserted: number;
  factsUpserted: number;
  incidentsOpened: Incident[];
  incidentsResolved: Incident[];
}

/** One raw accepted ingest payload, kept 7 days for debugging (D1 `snapshots`). */
export interface SnapshotRecord {
  site: string;
  sourceId: string;
  generatedAt: string;
  ok: boolean;
  /** The request body as received (never logged, never returned). */
  body: string;
}

/** A configured source of a site (`sites/<site>.json` `sources`). */
export interface SourceSpec {
  id: string;
  kind: SourceKind;
  expectedIntervalS: number;
}

export interface Store {
  /** Persist one accepted delta atomically (one D1 batch) and derive incident transitions from it. */
  applyDelta(delta: ModelDelta): Promise<ApplyResult>;
  /** Record a nonce; resolves false if it was already seen (replay). */
  claimNonce(nonce: string, expiresAt: string): Promise<boolean>;
  /** Assemble the current model for a site from D1. */
  loadSiteModel(site: string, now: string): Promise<SiteModel>;
  /**
   * Per service and UTC day, the 90 days ending with the day of `now` (the beat bars of `/view`).
   * Optional: a store without history serves views with no-data beat bars.
   */
  loadHistory?(site: string, now: string): Promise<ServiceDays[]>;
  /** Services' current rows for incident derivation (status before this delta). */
  currentServices(site: string): Promise<Service[]>;
  /**
   * Mark sources whose freshness crossed into `stale` and open or resolve `stale` incidents. With `watched`
   * (the site's configured and implied sources), only those can go stale and the open `stale` incidents of
   * any other source are resolved as retired (`RETIRED_NOTE` in src/worker/engine/incidents.ts).
   */
  sweepStaleness(site: string, now: string, watched?: ReadonlySet<string>): Promise<ApplyResult>;
  /** Keep one raw accepted payload (added at integration: the ingest service records every accepted one). */
  recordSnapshot(input: SnapshotRecord): Promise<void>;
  /** Create or update the site's configured sources (expected intervals); keeps last seen and ok. */
  syncSources(site: string, list: readonly SourceSpec[]): Promise<void>;
}

/** KV cache of the assembled model. */
export interface ModelCache {
  get(site: string): Promise<SiteModel | null>;
  /** Writes only if `model.generatedAt` is not older than what is cached. */
  put(model: SiteModel): Promise<void>;
}

/** `Store.applyDelta` rejects a delta carrying rows of another site (a key is bound to one site). */
export function assertDeltaSite(delta: ModelDelta): void {
  const { site } = delta;
  const foreign =
    delta.services.some((s) => s.site !== site) ||
    delta.heartbeats.some((h) => h.site !== site) ||
    delta.facts.some((f) => f.site !== site);
  if (foreign) throw new Error("Delta rows must all belong to the delta's site");
}
