/**
 * Where site configs come from. D1 (`site_configs`, see ./config-store.ts) is the source of truth; the
 * configs committed under `sites/*.json` seed each site's version 1 there. Callers read through a
 * `ConfigSource`: `D1ConfigStore` in the Worker, `seedConfigs` (the committed files, no storage) for the
 * in-memory test backends. A site that neither knows is unknown (the read API answers 404).
 */

import demo from "../../../sites/demo.json";
import { parseSiteConfig, type SiteConfig } from "../../shared/config";
import type { ConfigState } from "../../shared/schemas/admin";
import type { Store } from "./store";

const SEEDS: readonly SiteConfig[] = [parseSiteConfig(demo)];

const SEED_BY_SLUG: ReadonlyMap<string, SiteConfig> = new Map(SEEDS.map((c) => [c.slug, c]));

/** The committed config of a site, or null for anything else (including malformed slugs). */
export function seedConfig(slug: string): SiteConfig | null {
  return SEED_BY_SLUG.get(slug) ?? null;
}

/** Every committed site slug, in registry order. */
export function seedSlugs(): string[] {
  return SEEDS.map((c) => c.slug);
}

/** Current site configs. Implementations cache; a miss for an unknown site is cheap. */
export interface ConfigSource {
  /** The current config and its version, or null for an unknown site (including malformed slugs). */
  current(slug: string): Promise<ConfigState | null>;
  /** Every known site slug. */
  slugs(): Promise<string[]>;
}

/** The committed files as a `ConfigSource`: each is version 1, saved by `seed`. */
export const seedConfigs: ConfigSource = {
  current: async (slug) => {
    const config = seedConfig(slug);
    return config ? { config, version: 1, savedAt: "1970-01-01T00:00:00Z", savedBy: "seed" } : null;
  },
  slugs: async () => seedSlugs(),
};

/** The current config of a known site, or null. */
export async function getSiteConfig(configs: ConfigSource, slug: string): Promise<SiteConfig | null> {
  return (await configs.current(slug))?.config ?? null;
}

/** Site config versions this isolate has already written to the store, keyed `<site>@<version>`. */
const synced = new Map<string, Promise<void>>();

/**
 * Writes the site's configured sources (expected intervals) to the store once per isolate and config
 * version, so staleness uses the config's interval rather than the default a first ingest would insert,
 * and a saved config reaches the store the next time it is read. Concurrent callers share one write; a
 * failed write is forgotten so the next call retries. Unknown sites do nothing.
 */
export async function syncSiteSources(
  store: Pick<Store, "syncSources">,
  configs: ConfigSource,
  slug: string,
): Promise<void> {
  const state = await configs.current(slug);
  if (!state) return;
  const key = `${slug}@${state.version}`;
  let pending = synced.get(key);
  if (!pending) {
    pending = store
      .syncSources(
        slug,
        state.config.sources.map((s) => ({ id: s.id, kind: s.kind, expectedIntervalS: s.expectedIntervalS })),
      )
      .catch((err: unknown) => {
        synced.delete(key);
        throw err;
      });
    synced.set(key, pending);
  }
  return pending;
}

/** Forgets which sites were synced (tests that reset storage between cases). */
export function resetSiteSourceSync(): void {
  synced.clear();
}
