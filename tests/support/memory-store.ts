/**
 * In-memory `Store` and `ModelCache` for the ingest tests: the same contract the D1 and KV implementations
 * satisfy (src/worker/engine/store.ts), with the shared incident derivation.
 */
import type { Fact, Heartbeat, Incident, Service, Source } from "@/shared/model";
import type { ModelDelta } from "@/shared/schemas";
import { deriveDeltaIncidents } from "@/worker/engine/incidents";
import {
  type ApplyResult,
  assertDeltaSite,
  type ModelCache,
  RECENT_BEATS,
  type SiteModel,
  type SnapshotRecord,
  type SourceSpec,
  type Store,
} from "@/worker/engine/store";

const t = (s: string) => Date.parse(s);

export interface MemorySourceConfig {
  id: Source["id"];
  site: string;
  expectedIntervalS: number;
}

export class MemoryStore implements Store {
  readonly sources = new Map<string, Source>();
  readonly services = new Map<string, Service>();
  /** Keyed `${serviceId}|${epoch ms}`. */
  readonly heartbeats = new Map<string, Heartbeat>();
  readonly incidents = new Map<string, Incident>();
  /** Keyed `${site}|${group}|${key}`. */
  readonly facts = new Map<string, Fact>();
  readonly nonces = new Map<string, string>();
  readonly deltas: ModelDelta[] = [];
  readonly snapshots: SnapshotRecord[] = [];

  constructor(sources: MemorySourceConfig[] = []) {
    for (const s of sources) {
      this.sources.set(s.id, {
        id: s.id,
        site: s.site,
        kind: s.id.slice(0, s.id.indexOf(":")) as Source["kind"],
        expectedIntervalS: s.expectedIntervalS,
        lastSeenAt: null,
        lastOkAt: null,
      });
    }
  }

  async claimNonce(nonce: string, expiresAt: string): Promise<boolean> {
    if (this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, expiresAt);
    return true;
  }

  async currentServices(site: string): Promise<Service[]> {
    return [...this.services.values()].filter((s) => s.site === site);
  }

  async applyDelta(delta: ModelDelta): Promise<ApplyResult> {
    assertDeltaSite(delta);
    this.deltas.push(structuredClone(delta));
    const { site } = delta;
    const before = await this.currentServices(site);
    const existing = this.sources.get(delta.source.sourceId) ?? null;
    const src = existing ?? {
      id: delta.source.sourceId,
      site,
      kind: delta.source.sourceId.slice(0, delta.source.sourceId.indexOf(":")) as Source["kind"],
      expectedIntervalS: 60,
      lastSeenAt: null,
      lastOkAt: null,
    };
    const seen = delta.source.seenAt;
    const max = (a: string | null, b: string) => (a && t(a) > t(b) ? a : b);
    const touched: Source = {
      ...src,
      lastSeenAt: max(src.lastSeenAt, seen),
      lastOkAt: delta.source.ok ? max(src.lastOkAt, seen) : src.lastOkAt,
    };
    this.sources.set(src.id, touched);

    for (const s of delta.services) this.services.set(s.id, s);
    let heartbeatsInserted = 0;
    for (const h of delta.heartbeats) {
      const k = `${h.serviceId}|${t(h.ts)}`;
      if (this.heartbeats.has(k)) continue;
      this.heartbeats.set(k, h);
      heartbeatsInserted++;
    }
    for (const f of delta.facts) this.facts.set(`${f.site}|${f.group}|${f.key}`, f);

    // The same derivation D1Store runs, fed the same inputs (source before and after, rows before).
    const tr = deriveDeltaIncidents({
      delta,
      before,
      incidents: [...this.incidents.values()].filter((i) => i.site === site),
      previous: existing,
      touched: { ...touched, site },
    });
    const opened = tr.opened.filter((i) => !this.incidents.has(i.id));
    const resolved = tr.resolved.filter((i) => {
      const cur = this.incidents.get(i.id);
      return (cur && !cur.endedAt) || opened.some((o) => o.id === i.id);
    });
    for (const i of [...opened, ...resolved]) this.incidents.set(i.id, i);

    return {
      servicesUpserted: delta.services.length,
      heartbeatsInserted,
      factsUpserted: delta.facts.length,
      incidentsOpened: opened,
      incidentsResolved: resolved,
    };
  }

  async loadSiteModel(site: string, now: string): Promise<SiteModel> {
    const services = await this.currentServices(site);
    const perService = new Map<string, Heartbeat[]>();
    for (const h of this.heartbeats.values()) {
      if (h.site !== site) continue;
      const list = perService.get(h.serviceId) ?? [];
      list.push(h);
      perService.set(h.serviceId, list);
    }
    const recentHeartbeats = [...perService.values()].flatMap((l) =>
      l.sort((a, b) => t(b.ts) - t(a.ts)).slice(0, RECENT_BEATS),
    );
    const incidents = [...this.incidents.values()].filter((i) => i.site === site);
    return {
      site,
      generatedAt: now,
      sources: [...this.sources.values()].filter((s) => s.site === site),
      services,
      recentHeartbeats,
      openIncidents: incidents.filter((i) => !i.endedAt),
      recentIncidents: incidents.filter((i) => i.endedAt),
      facts: [...this.facts.values()].filter((f) => f.site === site),
    };
  }

  async recordSnapshot(input: SnapshotRecord): Promise<void> {
    this.snapshots.push({ ...input });
  }

  async syncSources(site: string, list: readonly SourceSpec[]): Promise<void> {
    for (const s of list) {
      const cur = this.sources.get(s.id);
      this.sources.set(s.id, {
        id: s.id as Source["id"],
        site,
        kind: s.kind,
        expectedIntervalS: s.expectedIntervalS,
        lastSeenAt: cur?.lastSeenAt ?? null,
        lastOkAt: cur?.lastOkAt ?? null,
      });
    }
  }

  async sweepStaleness(_site: string, _now: string): Promise<ApplyResult> {
    return {
      servicesUpserted: 0,
      heartbeatsInserted: 0,
      factsUpserted: 0,
      incidentsOpened: [],
      incidentsResolved: [],
    };
  }
}

export class MemoryCache implements ModelCache {
  readonly models = new Map<string, SiteModel>();
  puts = 0;

  async get(site: string): Promise<SiteModel | null> {
    const m = this.models.get(site);
    return m ? structuredClone(m) : null;
  }

  async put(model: SiteModel): Promise<void> {
    const cur = this.models.get(model.site);
    if (cur && t(model.generatedAt) < t(cur.generatedAt)) return;
    this.models.set(model.site, structuredClone(model));
    this.puts++;
  }
}

/** The demo site's sources, as in sites/demo.json. */
export const DEMO_SOURCES: MemorySourceConfig[] = [
  { id: "kuma:watch-1", site: "demo", expectedIntervalS: 60 },
  { id: "facts:app-1", site: "demo", expectedIntervalS: 900 },
];

export function memoryBackend(sources: MemorySourceConfig[] = DEMO_SOURCES) {
  const store = new MemoryStore(sources);
  const cache = new MemoryCache();
  return { store, cache };
}
