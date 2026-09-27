import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, json, updatedAt } from "./_helpers";

/** One row per site (tenant). Every other table carries `site`; there are no foreign keys to it. */
export const sites = sqliteTable("sites", {
  slug: text().primaryKey(),
  name: text().notNull(),
  hostnames: json<string[]>().notNull(),
  /** The current `site_configs.version`. */
  configVersion: integer().notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Every saved revision of a site's config (kept for rollback). */
export const siteConfigs = sqliteTable(
  "site_configs",
  {
    site: text().notNull(),
    version: integer().notNull(),
    /** The whole SiteConfig as JSON. */
    body: json<unknown>().notNull(),
    /** Who saved it: `seed`, `admin` or `import`; never shown on public surfaces. */
    savedBy: text(),
    /** Optional one-line note from the editor (shown in the revision list). */
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.site, t.version] })],
);
