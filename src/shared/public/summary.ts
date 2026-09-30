/**
 * Phase 6b contract (lead): what a site shows outside its page. Only sites with `public.enabled` answer;
 * every other site (private, or public without it) is 404 on all of these, exactly like an unknown site.
 * Each item of `public.fields` unlocks one part of the summary and nothing else; a part not allowed is
 * absent (never null, never empty), so a consumer can tell "not shared" from "nothing to show".
 *
 * | field            | unlocks                                                                |
 * |------------------|------------------------------------------------------------------------|
 * | `verdict`        | `verdict` (state and label); the site badge                             |
 * | `sections`       | `sections` with each service's state (ids only); service badges by id   |
 * | `serviceNames`   | names next to those services, and on service badges                     |
 * | `uptime90d`      | `uptime90d` per service; the uptime badge metric                        |
 * | `incidentTitles` | `incidents`: open ones and the last 5 resolved, titles and times only   |
 * | `generatedAt`    | `generatedAt`                                                           |
 *
 * Endpoints (the `public` stream): `GET /api/public/:site/summary.json` (CORS `*`, cached 30 s),
 * `GET /badge/:site.svg` (verdict), `GET /badge/:site/:service.svg?metric=status|uptime`,
 * `GET /embed/:site` (a small HTML widget for an iframe) and `GET /embed.js` (a script that renders the
 * widget from `summary.json` into `<div data-uptellis="<site>">`). Badges and the widget only show what the
 * summary would; a badge for a part not allowed is 404.
 */
import { z } from "zod";
import { IsoTimestamp, SiteSlug } from "../model/common";
import { safeDisplay } from "../model/safety";

export const PublicState = z.enum(["up", "degraded", "down", "maintenance", "stale", "unknown"]);
export type PublicState = z.infer<typeof PublicState>;

export const PublicService = z.object({
  id: z.string().min(1).max(80),
  state: PublicState,
  /** With `serviceNames`. */
  name: safeDisplay(150).optional(),
  /** With `uptime90d`: 0 to 1, null when there is no data. */
  uptime90d: z.number().min(0).max(1).nullable().optional(),
});
export type PublicService = z.infer<typeof PublicService>;

export const PublicSummary = z.object({
  v: z.literal(1),
  site: z.object({ slug: SiteSlug, name: safeDisplay(80) }),
  verdict: z
    .object({
      state: z.enum(["operational", "degraded", "outage", "maintenance", "stale", "empty"]),
      label: safeDisplay(80),
    })
    .optional(),
  sections: z
    .array(z.object({ id: z.string(), title: safeDisplay(80), services: z.array(PublicService) }))
    .optional(),
  incidents: z
    .array(
      z.object({
        title: safeDisplay(200),
        startedAt: IsoTimestamp,
        endedAt: IsoTimestamp.nullable(),
      }),
    )
    .optional(),
  generatedAt: IsoTimestamp.optional(),
});
export type PublicSummary = z.infer<typeof PublicSummary>;
