/**
 * Read API (plan section 5), mounted at `/api/sites`:
 *
 * - `GET /:site/model`   the assembled `SiteModel` (KV, else D1 and then KV is warmed)
 * - `GET /:site/sources` each source with `lastSeenAt`, age in seconds and freshness at request time
 * - `GET /:site/view`    the `SiteView` themes render: the model plus 90 days of history, built at request time
 * - `GET /?host=<name>`  `{ site }`: the site whose config lists that hostname, or null (the page's host lookup)
 *
 * Unknown sites answer 404. Every response is `Cache-Control: no-store`. The viewer gate in src/server.ts
 * runs before this (these paths are not in `GATE_OPEN_PATHS`), so nothing here re-checks the cookie.
 */
import { type Context, Hono } from "hono";
import { buildSourcesReport, type ReadDeps, readSiteModel, readSiteView } from "../engine/read-service";
import { getSiteConfig, seedConfigs } from "../engine/sites";

export type ReadDepsResolver = (env: Env) => ReadDeps;

export interface ReadRoutesOptions {
  /** Clock in epoch milliseconds (tests pin it). */
  now?: () => number;
}

const unknownSite = { error: "not_found", message: "Unknown site" } as const;

/** Builds the `/api/sites` sub-app over the given store and cache. */
export function readRoutes(resolve: ReadDepsResolver, opts: ReadRoutesOptions = {}) {
  const now = opts.now ?? Date.now;
  const app = new Hono<{ Bindings: Env }>();

  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("cache-control", "no-store");
  });

  /** Keeps a cache warm-up alive after the response when the runtime allows it. */
  const defer = (c: Context, p: Promise<void>) => {
    try {
      c.executionCtx.waitUntil(p);
      return Promise.resolve();
    } catch {
      return p; // No ExecutionContext (plain app.request in tests): finish before responding.
    }
  };

  /** The request's deps and the config of its `:site`, or null for an unknown site. */
  const siteOf = async (c: Context<{ Bindings: Env }>) => {
    const deps = resolve(c.env);
    const config = await getSiteConfig(deps.configs ?? seedConfigs, c.req.param("site") ?? "");
    return config ? { deps, config } : null;
  };

  app.get("/", async (c) => {
    const host = (c.req.query("host") ?? "").toLowerCase();
    const configs = resolve(c.env).configs ?? seedConfigs;
    for (const slug of await configs.slugs()) {
      if ((await getSiteConfig(configs, slug))?.hostnames.includes(host)) return c.json({ site: slug });
    }
    return c.json({ site: null });
  });

  app.get("/:site/model", async (c) => {
    const site = await siteOf(c);
    if (!site) return c.json(unknownSite, 404);
    const read = await readSiteModel(site.deps, site.config.slug, now());
    await defer(c, read.warmed);
    return c.json(read.model);
  });

  app.get("/:site/sources", async (c) => {
    const site = await siteOf(c);
    if (!site) return c.json(unknownSite, 404);
    const t = now();
    const read = await readSiteModel(site.deps, site.config.slug, t);
    await defer(c, read.warmed);
    return c.json(buildSourcesReport(site.config, read.model, t));
  });

  app.get("/:site/view", async (c) => {
    const site = await siteOf(c);
    if (!site) return c.json(unknownSite, 404);
    const read = await readSiteView(site.deps, site.config, now());
    await defer(c, read.warmed);
    return c.json(read.view);
  });

  return app;
}
