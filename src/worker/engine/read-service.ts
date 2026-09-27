/**
 * Read side of the engine (plan section 5): serves the assembled `SiteModel` from the KV cache, falling
 * back to D1 when the cache is empty and warming it, reports source freshness at request time, and builds
 * the `SiteView` themes render. Pure over the `Store` and `ModelCache` contracts, so it runs the same
 * against D1 and the in-memory store.
 */
import type { SiteConfig } from "../../shared/config";
import { type Source, type SourceFreshness, sourceAgeS, sourceFreshness } from "../../shared/model";
import { buildSiteView, type SiteView } from "../../shared/view";
import type { ConfigSource } from "./sites";
import type { ModelCache, SiteModel, Store } from "./store";

/** UTC ISO timestamp at whole seconds (`2026-09-27T23:58:00Z`), the model's timestamp style. */
export const isoSeconds = (ms: number) =>
  new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");

export interface ReadDeps {
  store: Store;
  cache: ModelCache;
  /** Site configs; the committed `sites/*.json` (`seedConfigs`) when absent. */
  configs?: ConfigSource;
}

export interface ModelRead {
  model: SiteModel;
  /** `cache` when KV had it, `store` when it was assembled from D1 (and the cache was warmed). */
  from: "cache" | "store";
  /** Resolves once the cache write (if any) has settled; never rejects. */
  warmed: Promise<void>;
}

/**
 * The current model for `site`: KV first, else `Store.loadSiteModel`, which is then written back to KV.
 * A failed cache read or write never fails the request; the store stays the source of truth.
 */
export async function readSiteModel(deps: ReadDeps, site: string, nowMs: number): Promise<ModelRead> {
  let cached: SiteModel | null = null;
  try {
    cached = await deps.cache.get(site);
  } catch (err) {
    console.warn("read: model cache get failed", { site, error: String(err) });
  }
  if (cached) return { model: cached, from: "cache", warmed: Promise.resolve() };

  const model = await deps.store.loadSiteModel(site, isoSeconds(nowMs));
  const warmed = deps.cache.put(model).catch((err: unknown) => {
    console.warn("read: model cache put failed", { site, error: String(err) });
  });
  return { model, from: "store", warmed };
}

export interface ViewRead {
  view: SiteView;
  /** As `ModelRead.warmed`. */
  warmed: Promise<void>;
}

/**
 * The `SiteView` of `config`'s site at `nowMs`: the current model (as `readSiteModel`) and the 90-day
 * history (always from the store; empty when the store keeps none), read in parallel.
 */
export async function readSiteView(deps: ReadDeps, config: SiteConfig, nowMs: number): Promise<ViewRead> {
  const [read, history] = await Promise.all([
    readSiteModel(deps, config.slug, nowMs),
    deps.store.loadHistory?.(config.slug, isoSeconds(nowMs)) ?? [],
  ]);
  return { view: buildSiteView({ model: read.model, history, config, now: nowMs }), warmed: read.warmed };
}

export interface SourceReport {
  id: Source["id"];
  kind: Source["kind"];
  expectedIntervalS: number;
  lastSeenAt: string | null;
  lastOkAt: string | null;
  /** Whole seconds since `lastSeenAt` at request time, null if never seen. */
  ageS: number | null;
  freshness: SourceFreshness;
}

export interface SourcesReport {
  site: string;
  now: string;
  generatedAt: string;
  sources: SourceReport[];
}

/**
 * Every source of the site with its freshness at `nowMs`. Configured sources come first in config order
 * (a configured source the store has never seen reports `empty`), then any extra sources the model holds.
 * The model's `expectedIntervalS` wins over the config's when both exist, since that is what staleness
 * sweeps use.
 */
export function buildSourcesReport(config: SiteConfig, model: SiteModel, nowMs: number): SourcesReport {
  const byId = new Map(model.sources.map((s) => [s.id, s]));
  const rows: Pick<Source, "id" | "kind" | "expectedIntervalS" | "lastSeenAt" | "lastOkAt">[] = [];
  for (const c of config.sources) {
    const s = byId.get(c.id);
    rows.push(
      s ?? {
        id: c.id,
        kind: c.kind,
        expectedIntervalS: c.expectedIntervalS,
        lastSeenAt: null,
        lastOkAt: null,
      },
    );
    byId.delete(c.id);
  }
  rows.push(...byId.values());

  return {
    site: config.slug,
    now: isoSeconds(nowMs),
    generatedAt: model.generatedAt,
    sources: rows.map((s) => {
      const age = sourceAgeS(s, nowMs);
      return {
        id: s.id,
        kind: s.kind,
        expectedIntervalS: s.expectedIntervalS,
        lastSeenAt: s.lastSeenAt,
        lastOkAt: s.lastOkAt,
        ageS: age === null || Number.isNaN(age) ? null : Math.floor(age),
        freshness: sourceFreshness(s, nowMs),
      };
    }),
  };
}
