/**
 * Public endpoints (Phase 6b, the contract in src/shared/public/summary.ts): what a site shows outside its
 * page. They are anonymous by design: no principal is resolved, and a signed-in user sees exactly what
 * anyone else does. Only a public site with `public.enabled` answers (`isPublished`); every other site
 * (unknown, private, or public without it) and every part its `public.fields` does not allow is the same
 * 404, so nothing reveals that a site exists.
 *
 * - `GET /api/public/:site/summary.json`  the `PublicSummary` (CORS `*`, no credentials, cached 30 s)
 * - `GET /badge/:site.svg`                 the verdict badge (needs `verdict`)
 * - `GET /badge/:site/:service.svg`        a service badge (needs `sections`); `?metric=uptime` needs `uptime90d`
 * - `GET /embed/:site`                     the widget page for an iframe (any origin may frame it)
 * - `GET /embed.js`                        the script that draws the widget into `div[data-uptellis]`
 *
 * Framing and cross-origin loading are allowed for these paths only, in
 * src/worker/middleware/security-headers.ts.
 */
import { type Context, Hono } from "hono";
import type { SiteConfig } from "@/shared/config";
import type { PublicSummary } from "@/shared/public/summary";
import type { AppEnv } from "@/worker/app-env";
import { readSiteView } from "../engine/read-service";
import { getSiteConfig, seedConfigs, siteSources } from "../engine/sites";
import { formatUptime, renderBadge, uptimeState } from "../public/badge";
import { buildPublicSummary, isPublished, summaryService, verdictPublicState } from "../public/summary";
import { EMBED_SCRIPT, renderWidgetHtml } from "../public/widget";
import type { ReadDepsResolver } from "./read";

export interface PublicRoutesOptions {
  /** Clock in epoch milliseconds (tests pin it). */
  now?: () => number;
}

export const SUMMARY_CACHE = "public, max-age=30";
export const BADGE_CACHE = "public, max-age=60";
export const EMBED_CACHE = "public, max-age=30";
export const SCRIPT_CACHE = "public, max-age=3600";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-max-age": "86400",
} as const;

const SVG_SUFFIX = ".svg";
const svgName = (file: string | undefined) =>
  file?.endsWith(SVG_SUFFIX) ? file.slice(0, -SVG_SUFFIX.length) : null;

/** The one 404 of the public endpoints: JSON under `/api/`, plain text elsewhere, never cached. */
function notFound(c: Context<AppEnv>, cors = false): Response {
  const headers: Record<string, string> = { "cache-control": "no-store", ...(cors ? CORS : {}) };
  return c.req.path.startsWith("/api/")
    ? c.json({ error: "not_found", message: "Not found" }, 404, headers)
    : c.text("Not found", 404, headers);
}

/** Registers the public endpoints on `app` (the root app: they span `/api/public`, `/badge` and `/embed`). */
export function publicRoutes(resolve: ReadDepsResolver, opts: PublicRoutesOptions = {}) {
  const now = opts.now ?? Date.now;
  const app = new Hono<AppEnv>();

  /** The published site's config (effective sources) and summary, or null for any site that is not. */
  const summaryOf = async (
    c: Context<AppEnv>,
    slug: string | null | undefined,
  ): Promise<{ config: SiteConfig; summary: PublicSummary } | null> => {
    if (!slug) return null;
    const deps = resolve(c.var.platform);
    const found = await getSiteConfig(deps.configs ?? seedConfigs, slug);
    if (!found || !isPublished(found)) return null;
    const config = { ...found, sources: siteSources(found, c.var.platform.runtime) };
    const read = await readSiteView(deps, config, now());
    c.var.platform.waitUntil(read.warmed);
    return { config, summary: buildPublicSummary(read.view, config.public.fields) };
  };

  const svg = (c: Context<AppEnv>, body: string) =>
    c.body(body, 200, { "content-type": "image/svg+xml", "cache-control": BADGE_CACHE });

  app.options("/api/public/:site/summary.json", (c) => c.body(null, 204, { ...CORS }));

  app.get("/api/public/:site/summary.json", async (c) => {
    const found = await summaryOf(c, c.req.param("site"));
    if (!found) return notFound(c, true);
    return c.json(found.summary, 200, { ...CORS, "cache-control": SUMMARY_CACHE });
  });

  app.get("/badge/:file", async (c) => {
    const found = await summaryOf(c, svgName(c.req.param("file")));
    const verdict = found?.summary.verdict;
    if (!found || !verdict) return notFound(c);
    return svg(
      c,
      renderBadge({
        label: found.summary.site.name,
        value: VERDICT_VALUE[verdict.state],
        state: verdictPublicState(verdict.state),
      }),
    );
  });

  app.get("/badge/:site/:file", async (c) => {
    const id = svgName(c.req.param("file"));
    const metric = c.req.query("metric") ?? "status";
    if (!id || (metric !== "status" && metric !== "uptime")) return notFound(c);
    const found = await summaryOf(c, c.req.param("site"));
    const service = found && summaryService(found.summary, id);
    if (!service) return notFound(c);
    const label = service.name ?? service.id;
    if (metric === "status")
      return svg(c, renderBadge({ label, value: service.state, state: service.state }));
    if (service.uptime90d === undefined) return notFound(c);
    return svg(
      c,
      renderBadge({ label, value: formatUptime(service.uptime90d), state: uptimeState(service.uptime90d) }),
    );
  });

  app.get("/embed.js", (c) =>
    c.body(EMBED_SCRIPT, 200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": SCRIPT_CACHE,
    }),
  );

  app.get("/embed/:site", async (c) => {
    const found = await summaryOf(c, c.req.param("site"));
    if (!found) return notFound(c);
    const host = found.config.hostnames[0];
    return c.html(renderWidgetHtml(found.summary, host ? `https://${host}/` : null), 200, {
      "cache-control": EMBED_CACHE,
    });
  });

  return app;
}

/** The verdict badge's value: one short word per verdict state. */
const VERDICT_VALUE = {
  operational: "operational",
  degraded: "degraded",
  outage: "outage",
  maintenance: "maintenance",
  stale: "stale",
  empty: "no data",
} as const;
