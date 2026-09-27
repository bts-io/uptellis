/**
 * Site configs in D1: every save is a new `site_configs` row (version + 1), the highest version is current,
 * and nothing is ever deleted (rollback is a restore, which saves again). A site with no rows is seeded on
 * first read with version 1 from its committed `sites/<slug>.json` (saved by `seed`).
 *
 * Reads for the dashboard go isolate memory (15 s) -> KV `config:<site>` -> D1. A save writes D1 first,
 * then refreshes KV and this isolate's memory; other isolates see it within their memory TTL (plus KV's
 * 30 s edge cache). Admin reads and every save read D1 directly, so optimistic concurrency (`baseVersion`)
 * always compares against the stored version.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { type SiteConfig, SiteConfig as SiteConfigSchema } from "@/shared/config";
import { diffConfigs } from "@/shared/config/diff";
import { SiteSlug } from "@/shared/model";
import type { ConfigDiffEntry, ConfigState, RevisionList } from "@/shared/schemas/admin";
import { createDb, type Db, schema } from "@/worker/db";
import { toIso } from "@/worker/db/util";
import { type ConfigSource, seedConfig, seedSlugs } from "./sites";

const { siteConfigs, sites } = schema;

/** KV key of a site's current `ConfigState`. */
export const configKey = (site: string) => `config:${site}`;

/** How long this isolate trusts a config (or an unknown site) it has read. */
export const CONFIG_MEMORY_TTL_MS = 15_000;
/** KV edge cache for config reads (KV's minimum), and how long the KV copy lives at all. */
const KV_CACHE_TTL_S = 30;
const KV_EXPIRATION_S = 3600;

type Row = typeof siteConfigs.$inferSelect;
type Stmt = BatchItem<"sqlite">;

const memory = new Map<string, { state: ConfigState | null; until: number }>();
let knownSlugs: { slugs: string[]; until: number } | null = null;

/** Forgets every config this isolate cached (tests that reset storage or save behind the store's back). */
export function resetConfigCache(): void {
  memory.clear();
  knownSlugs = null;
}

const toState = (row: Row): ConfigState => ({
  config: SiteConfigSchema.parse(row.body),
  version: row.version,
  savedAt: toIso(row.createdAt),
  savedBy: row.savedBy ?? "admin",
});

/** Logs a failed cache step by error name only. */
const warn = (step: string, err: unknown) =>
  console.warn(JSON.stringify({ evt: "config", step, name: err instanceof Error ? err.name : "unknown" }));

export type SaveOutcome =
  | { ok: true; version: number; diff: ConfigDiffEntry[] }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "conflict"; currentVersion: number };

export interface SaveOptions {
  /** The version the edit started from; anything else is a conflict. */
  baseVersion: number;
  savedBy: "admin" | "import";
  note?: string | null;
  /** Statements committed atomically with the new revision (a new source's key). */
  with?: Stmt[];
}

export class D1ConfigStore implements ConfigSource {
  private readonly db: Db;

  constructor(
    db: Db | D1Database,
    private readonly kv?: KVNamespace,
  ) {
    this.db = "batch" in db && "select" in db ? (db as Db) : createDb(db as D1Database);
  }

  /** The current config for the dashboard (cached as described above), or null for an unknown site. */
  async current(slug: string): Promise<ConfigState | null> {
    const hit = memory.get(slug);
    if (hit && hit.until > Date.now()) return hit.state;
    if (!SiteSlug.safeParse(slug).success) return null;

    let state: ConfigState | null = null;
    try {
      const cached = await this.kv?.get<ConfigState>(configKey(slug), {
        type: "json",
        cacheTtl: KV_CACHE_TTL_S,
      });
      if (cached) state = { ...cached, config: SiteConfigSchema.parse(cached.config) };
    } catch (err) {
      warn("kv_get", err);
    }
    if (!state) {
      state = await this.load(slug);
      if (state) await this.putKv(slug, state);
    }
    memory.set(slug, { state, until: Date.now() + CONFIG_MEMORY_TTL_MS });
    return state;
  }

  /** Committed sites first (registry order), then any other site with a saved config. */
  async slugs(): Promise<string[]> {
    if (knownSlugs && knownSlugs.until > Date.now()) return knownSlugs.slugs;
    const seeds = seedSlugs();
    const rows = await this.db
      .selectDistinct({ site: siteConfigs.site })
      .from(siteConfigs)
      .orderBy(asc(siteConfigs.site));
    const slugs = [...seeds, ...rows.map((r) => r.site).filter((s) => !seeds.includes(s))];
    knownSlugs = { slugs, until: Date.now() + CONFIG_MEMORY_TTL_MS };
    return slugs;
  }

  /** The current config straight from D1 (seeding version 1 for a committed site), or null. */
  async load(slug: string): Promise<ConfigState | null> {
    if (!SiteSlug.safeParse(slug).success) return null;
    const row = await this.latestRow(slug);
    if (row) return toState(row);
    const seed = seedConfig(slug);
    if (!seed) return null;
    await this.db.batch([
      this.db
        .insert(siteConfigs)
        .values({ site: slug, version: 1, body: seed, savedBy: "seed" })
        .onConflictDoNothing(),
      this.upsertSite(seed, 1),
    ]);
    const seeded = await this.latestRow(slug);
    return seeded ? toState(seeded) : null;
  }

  /**
   * Saves `config` as the next revision when `baseVersion` is still current. An unchanged config saves
   * nothing and answers the current version with an empty diff. A concurrent save of the same version
   * loses on the `(site, version)` key and is reported as a conflict.
   */
  async save(slug: string, config: SiteConfig, opts: SaveOptions): Promise<SaveOutcome> {
    const cur = await this.load(slug);
    if (!cur) return { ok: false, error: "not_found" };
    if (cur.version !== opts.baseVersion)
      return { ok: false, error: "conflict", currentVersion: cur.version };
    const diff = diffConfigs(cur.config, config);
    if (diff.length === 0) return { ok: true, version: cur.version, diff };

    const version = cur.version + 1;
    const createdAt = Date.now();
    try {
      await this.db.batch([
        this.db.insert(siteConfigs).values({
          site: slug,
          version,
          body: config,
          savedBy: opts.savedBy,
          note: opts.note ?? null,
          createdAt,
        }),
        this.upsertSite(config, version),
        ...(opts.with ?? []),
      ]);
    } catch (err) {
      const now = (await this.latestRow(slug))?.version ?? cur.version;
      if (now !== cur.version) return { ok: false, error: "conflict", currentVersion: now };
      throw err;
    }
    const state: ConfigState = { config, version, savedAt: toIso(createdAt), savedBy: opts.savedBy };
    memory.set(slug, { state, until: Date.now() + CONFIG_MEMORY_TTL_MS });
    knownSlugs = null;
    await this.putKv(slug, state);
    return { ok: true, version, diff };
  }

  /** Every revision, newest first, each with its number of changed fields against the one before. */
  async revisions(slug: string): Promise<RevisionList | null> {
    const cur = await this.load(slug);
    if (!cur) return null;
    const rows = await this.db
      .select()
      .from(siteConfigs)
      .where(eq(siteConfigs.site, slug))
      .orderBy(asc(siteConfigs.version));
    const revisions: RevisionList["revisions"] = [];
    let prev: unknown;
    for (const [i, r] of rows.entries()) {
      revisions.push({
        version: r.version,
        savedAt: toIso(r.createdAt),
        savedBy: r.savedBy ?? "admin",
        note: r.note ?? null,
        changes: i === 0 ? 0 : diffConfigs(prev, r.body).length,
      });
      prev = r.body;
    }
    return { current: cur.version, revisions: revisions.reverse() };
  }

  /** One saved revision's config, or null when the site or version does not exist. */
  async revision(slug: string, version: number): Promise<SiteConfig | null> {
    const [row] = await this.db
      .select()
      .from(siteConfigs)
      .where(and(eq(siteConfigs.site, slug), eq(siteConfigs.version, version)));
    return row ? SiteConfigSchema.parse(row.body) : null;
  }

  private async latestRow(slug: string): Promise<Row | undefined> {
    const [row] = await this.db
      .select()
      .from(siteConfigs)
      .where(eq(siteConfigs.site, slug))
      .orderBy(desc(siteConfigs.version))
      .limit(1);
    return row;
  }

  /** Keeps the `sites` row (name, hostnames, current version) in step with the config. */
  private upsertSite(config: SiteConfig, version: number) {
    const now = Date.now();
    const values = { name: config.name, hostnames: config.hostnames, configVersion: version, updatedAt: now };
    return this.db
      .insert(sites)
      .values({ slug: config.slug, ...values })
      .onConflictDoUpdate({ target: sites.slug, set: values });
  }

  private async putKv(slug: string, state: ConfigState): Promise<void> {
    try {
      await this.kv?.put(configKey(slug), JSON.stringify(state), { expirationTtl: KV_EXPIRATION_S });
    } catch (err) {
      warn("kv_put", err);
    }
  }
}
