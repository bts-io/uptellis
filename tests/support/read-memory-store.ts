/**
 * In-memory `Store` and `ModelCache` for the read API tests (the D1 and KV implementations come from the
 * storage stream). Only `loadSiteModel` and the cache matter to the read path; the write methods do the
 * simplest thing that keeps the contract so a test can move the model forward.
 */
import type { Fact, Heartbeat, Incident, Service, Source } from "../../src/shared/model";
import type { ModelDelta } from "../../src/shared/schemas";
import {
  type ApplyResult,
  type ModelCache,
  RECENT_BEATS,
  type SiteModel,
  type SnapshotRecord,
  type SourceSpec,
  type Store,
} from "../../src/worker/engine/store";

export interface MemorySiteData {
  sources: Source[];
  services: Service[];
  heartbeats: Heartbeat[];
  incidents: Incident[];
  facts: Fact[];
}

const empty = (): MemorySiteData => ({ sources: [], services: [], heartbeats: [], incidents: [], facts: [] });
const noChange = (): ApplyResult => ({
  servicesUpserted: 0,
  heartbeatsInserted: 0,
  factsUpserted: 0,
  incidentsOpened: [],
  incidentsResolved: [],
});

export class MemoryStore implements Store {
  readonly sites = new Map<string, MemorySiteData>();
  readonly nonces = new Map<string, string>();
  /** Calls to `loadSiteModel`, so tests can tell a cache hit from a store read. */
  loads = 0;

  constructor(seed: Record<string, Partial<MemorySiteData>> = {}) {
    for (const [site, data] of Object.entries(seed)) this.sites.set(site, { ...empty(), ...data });
  }

  private data(site: string): MemorySiteData {
    let d = this.sites.get(site);
    if (!d) this.sites.set(site, (d = empty()));
    return d;
  }

  async applyDelta(delta: ModelDelta): Promise<ApplyResult> {
    const d = this.data(delta.site);
    const src = d.sources.find((s) => s.id === delta.source.sourceId);
    if (src) {
      src.lastSeenAt = delta.source.seenAt;
      if (delta.source.ok) src.lastOkAt = delta.source.seenAt;
    }
    for (const s of delta.services) {
      d.services = [...d.services.filter((x) => x.id !== s.id), s];
    }
    let heartbeatsInserted = 0;
    for (const h of delta.heartbeats) {
      if (d.heartbeats.some((x) => x.serviceId === h.serviceId && x.ts === h.ts)) continue;
      d.heartbeats.push(h);
      heartbeatsInserted++;
    }
    for (const f of delta.facts) {
      d.facts = [...d.facts.filter((x) => !(x.group === f.group && x.key === f.key)), f];
    }
    return {
      ...noChange(),
      servicesUpserted: delta.services.length,
      heartbeatsInserted,
      factsUpserted: delta.facts.length,
    };
  }

  async claimNonce(nonce: string, expiresAt: string): Promise<boolean> {
    if (this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, expiresAt);
    return true;
  }

  async loadSiteModel(site: string, now: string): Promise<SiteModel> {
    this.loads++;
    const d = structuredClone(this.data(site));
    const recentHeartbeats = d.services.flatMap((s) =>
      d.heartbeats
        .filter((h) => h.serviceId === s.id)
        .sort((a, b) => b.ts.localeCompare(a.ts))
        .slice(0, RECENT_BEATS),
    );
    return {
      site,
      generatedAt: now,
      sources: d.sources,
      services: d.services,
      recentHeartbeats,
      openIncidents: d.incidents.filter((i) => i.endedAt === null),
      recentIncidents: d.incidents.filter((i) => i.endedAt !== null),
      facts: d.facts,
    };
  }

  async currentServices(site: string): Promise<Service[]> {
    return structuredClone(this.data(site).services);
  }

  async sweepStaleness(_site: string, _now: string): Promise<ApplyResult> {
    return noChange();
  }

  async recordSnapshot(_input: SnapshotRecord): Promise<void> {}

  async syncSources(site: string, list: readonly SourceSpec[]): Promise<void> {
    const d = this.data(site);
    for (const s of list) {
      const cur = d.sources.find((x) => x.id === s.id);
      if (cur) cur.expectedIntervalS = s.expectedIntervalS;
      else
        d.sources.push({
          id: s.id as Source["id"],
          site,
          kind: s.kind,
          expectedIntervalS: s.expectedIntervalS,
          lastSeenAt: null,
          lastOkAt: null,
        });
    }
  }
}

export class MemoryModelCache implements ModelCache {
  readonly models = new Map<string, SiteModel>();
  gets = 0;
  puts = 0;

  async get(site: string): Promise<SiteModel | null> {
    this.gets++;
    const m = this.models.get(site);
    return m ? structuredClone(m) : null;
  }

  async put(model: SiteModel): Promise<void> {
    this.puts++;
    const cur = this.models.get(model.site);
    if (cur && Date.parse(cur.generatedAt) > Date.parse(model.generatedAt)) return;
    this.models.set(model.site, structuredClone(model));
  }
}
