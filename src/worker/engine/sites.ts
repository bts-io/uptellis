/**
 * Where site configs come from. D1 (`site_configs`, see ./config-store.ts) is the source of truth; the
 * configs committed under `sites/*.json` seed each site's version 1 there. Callers read through a
 * `ConfigSource`: `D1ConfigStore` in the Worker, `seedConfigs` (the committed files, no storage) for the
 * in-memory test backends. A site that neither knows is unknown (the read API answers 404).
 */

import demo from "../../../sites/demo.json";
import type { Runtime } from "../../platform/types";
import { parseSiteConfig, type SiteConfig } from "../../shared/config";
import { BUILTIN_RUNNER, monitorsOf, RUNNER_TYPES, runnerSourceId } from "../../shared/monitors";
import type { ConfigState } from "../../shared/schemas/admin";
import type { SourceSpec, Store } from "./store";

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

/** Site config versions this isolate has already written to the store, keyed `<site>@<version>@<runtime>`. */
const synced = new Map<string, Promise<void>>();

/** Implied runner sources never expect a report more often than this. */
export const MIN_RUNNER_INTERVAL_S = 60;

/**
 * The sources a site's store should know: the configured `sources`, plus one per runner its monitors use
 * (`runnerSourceId`: `builtin` is `probe:cf` on Cloudflare and `probe:server` in Docker, an agent is
 * `probe:<agent>`) that the config does not list, expecting a report every smallest interval of that
 * runner's monitors (at least `MIN_RUNNER_INTERVAL_S`). A silent agent then raises a `stale` incident
 * like any source. Paused monitors, and types a runner cannot run here (`RUNNER_TYPES`), imply nothing:
 * that runner would never report them.
 */
export function siteSources(config: SiteConfig, runtime: Runtime): SourceSpec[] {
  const out: SourceSpec[] = config.sources.map((s) => ({
    id: s.id,
    kind: s.kind,
    expectedIntervalS: s.expectedIntervalS,
  }));
  const listed = new Set(out.map((s) => s.id));
  const implied = new Map<string, number>();
  for (const m of monitorsOf(config)) {
    if (!m.enabled) continue;
    for (const r of m.runners) {
      if (!RUNNER_TYPES[r === BUILTIN_RUNNER ? runtime : "agent"].includes(m.type)) continue;
      const id = runnerSourceId(r, runtime);
      if (listed.has(id)) continue;
      implied.set(id, Math.min(implied.get(id) ?? Number.POSITIVE_INFINITY, m.intervalS));
    }
  }
  for (const [id, intervalS] of implied) {
    out.push({ id, kind: "probe", expectedIntervalS: Math.max(MIN_RUNNER_INTERVAL_S, intervalS) });
  }
  return out;
}

/**
 * Writes the site's sources (`siteSources`: configured and implied, with expected intervals) to the store
 * once per isolate, config version and runtime, so staleness uses the config's interval rather than the
 * default a first ingest would insert, and a saved config reaches the store the next time it is read.
 * Concurrent callers share one write; a failed write is forgotten so the next call retries. Unknown sites
 * do nothing.
 */
export async function syncSiteSources(
  store: Pick<Store, "syncSources">,
  configs: ConfigSource,
  slug: string,
  runtime: Runtime = "cloudflare",
): Promise<void> {
  const state = await configs.current(slug);
  if (!state) return;
  const key = `${slug}@${state.version}@${runtime}`;
  let pending = synced.get(key);
  if (!pending) {
    pending = store.syncSources(slug, siteSources(state.config, runtime)).catch((err: unknown) => {
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
