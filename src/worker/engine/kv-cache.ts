import type { ModelCache, SiteModel } from "./store";

/** KV key of a site's assembled model. */
export const latestKey = (site: string) => `latest:${site}`;

/** Edge cache time for reads (KV's minimum). */
export const CACHE_TTL_S = 30;

/**
 * `ModelCache` on KV: `latest:<site>` as JSON. A put never replaces a model with a newer `generatedAt`.
 * KV has no compare-and-swap, so two racing writers can still interleave; the next ingest corrects it.
 */
export class KvModelCache implements ModelCache {
  constructor(private readonly kv: KVNamespace) {}

  async get(site: string): Promise<SiteModel | null> {
    return this.kv.get<SiteModel>(latestKey(site), { type: "json", cacheTtl: CACHE_TTL_S });
  }

  async put(model: SiteModel): Promise<void> {
    const key = latestKey(model.site);
    // Read without cacheTtl so the comparison sees the stored value, not an edge copy.
    const current = await this.kv.get<Pick<SiteModel, "generatedAt">>(key, { type: "json" });
    if (current && Date.parse(current.generatedAt) > Date.parse(model.generatedAt)) return;
    await this.kv.put(key, JSON.stringify(model), { metadata: { generatedAt: model.generatedAt } });
  }
}
