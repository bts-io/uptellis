/**
 * Read API (plan section 5), mounted at `/api/sites`:
 *
 * - `GET /:site/model`   the assembled `SiteModel` (the cache, else the store and then the cache is warmed)
 * - `GET /:site/sources` each source with `lastSeenAt`, age in seconds and freshness at request time
 * - `GET /:site/view`    the `SiteView` themes render: the model plus 90 days of history, built at request time
 * - `GET /?host=<name>`  `{ site }`: the site whose config lists that hostname, or null (the page's host lookup)
 *
 * Unknown sites answer 404, and so do private sites the principal may not view (`page.view`,
 * src/shared/auth.ts: a signed-in user, or an API key of that site with the `read` scope), so a private
 * site is indistinguishable from none. Public sites are open. Every response is `Cache-Control: no-store`.
 */
import { type Context, Hono } from "hono";
import type { Platform } from "@/platform/types";
import { can } from "@/shared/auth";
import type { AppEnv } from "@/worker/app-env";
import { principalOf } from "../auth/context";
import { buildSourcesReport, type ReadDeps, readSiteModel, readSiteView } from "../engine/read-service";
import { getSiteConfig, seedConfigs } from "../engine/sites";

export type ReadDepsResolver = (platform: Platform) => ReadDeps;

export interface ReadRoutesOptions {
  /** Clock in epoch milliseconds (tests pin it). */
  now?: () => number;
}

const unknownSite = { error: "not_found", message: "Unknown site" } as const;

/** Builds the `/api/sites` sub-app over the given store and cache. */
export function readRoutes(resolve: ReadDepsResolver, opts: ReadRoutesOptions = {}) {
  const now = opts.now ?? Date.now;
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("cache-control", "no-store");
  });

  /** Keeps a cache warm-up alive after the response. */
  const defer = (c: Context<AppEnv>, p: Promise<void>) => c.var.platform.waitUntil(p);

  /** The request's deps and the config of its `:site`, or null for an unknown or hidden site. */
  const siteOf = async (c: Context<AppEnv>) => {
    const deps = resolve(c.var.platform);
    const config = await getSiteConfig(deps.configs ?? seedConfigs, c.req.param("site") ?? "");
    return config && can(principalOf(c), "page.view", config) ? { deps, config } : null;
  };

  app.get("/", async (c) => {
    const host = (c.req.query("host") ?? "").toLowerCase();
    const configs = resolve(c.var.platform).configs ?? seedConfigs;
    for (const slug of await configs.slugs()) {
      if ((await getSiteConfig(configs, slug))?.hostnames.includes(host)) return c.json({ site: slug });
    }
    return c.json({ site: null });
  });

  app.get("/:site/model", async (c) => {
    const site = await siteOf(c);
    if (!site) return c.json(unknownSite, 404);
    const read = await readSiteModel(site.deps, site.config.slug, now());
    defer(c, read.warmed);
    return c.json(read.model);
  });

  app.get("/:site/sources", async (c) => {
    const site = await siteOf(c);
    if (!site) return c.json(unknownSite, 404);
    const t = now();
    const read = await readSiteModel(site.deps, site.config.slug, t);
    defer(c, read.warmed);
    return c.json(buildSourcesReport(site.config, read.model, t));
  });

  app.get("/:site/view", async (c) => {
    const site = await siteOf(c);
    if (!site) return c.json(unknownSite, 404);
    const read = await readSiteView(site.deps, site.config, now());
    defer(c, read.warmed);
    return c.json(read.view);
  });

  return app;
}
