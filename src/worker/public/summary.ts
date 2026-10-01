/**
 * The public summary of a site (the Phase 6b contract in src/shared/public/summary.ts), built from its
 * `SiteView` and nothing else. Each `public.fields` item unlocks exactly one part; a part not allowed is
 * left out of the object (never null, never empty), and badges and the widget only ever read this.
 */
import type { PublicField, SiteConfig } from "@/shared/config";
import type { PublicState, PublicSummary } from "@/shared/public/summary";
import type { DisplayState, ServiceView, SiteView, VerdictState } from "@/shared/view";

/** Open incidents are all listed; resolved ones only the newest this many. */
export const RESOLVED_INCIDENTS = 5;

/**
 * True when `config` answers the public endpoints: a public page with `public.enabled`. A private site
 * never does, whatever its `public` block says, so its existence is never revealed.
 */
export const isPublished = (config: Pick<SiteConfig, "visibility" | "public">): boolean =>
  config.visibility === "public" && config.public.enabled;

const STATE_OF: Record<DisplayState, PublicState> = {
  up: "up",
  degraded: "degraded",
  // A failing check not yet confirmed (see docs/monitors.md): visible, never paged, like degraded.
  pending: "degraded",
  down: "down",
  maintenance: "maintenance",
  stale: "stale",
  paused: "unknown",
  unknown: "unknown",
};

/** A service's display state as the public sees it. */
export const publicState = (state: DisplayState): PublicState => STATE_OF[state] ?? "unknown";

/**
 * A service as the public sees it: `publicState`, except that a `pending` service that has never checked
 * (a monitor before its first result: no recent beats, no day with data) is `unknown`, not a failing check.
 */
export const servicePublicState = (s: Pick<ServiceView, "state" | "recent" | "beats90d">): PublicState =>
  s.state === "pending" && s.recent.length === 0 && s.beats90d.every((d) => d.worst === null)
    ? "unknown"
    : publicState(s.state);

const VERDICT_STATE: Record<VerdictState, PublicState> = {
  operational: "up",
  degraded: "degraded",
  outage: "down",
  maintenance: "maintenance",
  stale: "stale",
  empty: "unknown",
};

/** The colour state of a site verdict (badges and the widget). */
export const verdictPublicState = (state: VerdictState): PublicState => VERDICT_STATE[state] ?? "unknown";

/** Mean of the days with data in the 90-day history (0 to 1, six decimals), or null without any. */
export function uptime90dOf(service: Pick<ServiceView, "beats90d">): number | null {
  const days = service.beats90d.map((d) => d.uptime).filter((u): u is number => typeof u === "number");
  if (days.length === 0) return null;
  const mean = days.reduce((a, b) => a + b, 0) / days.length;
  return Math.min(1, Math.max(0, Math.round(mean * 1e6) / 1e6));
}

/** The summary of `view` with only the parts `fields` allows. */
export function buildPublicSummary(view: SiteView, fields: readonly PublicField[]): PublicSummary {
  const allowed = new Set(fields);
  const out: PublicSummary = { v: 1, site: { slug: view.site.slug, name: view.site.name } };

  if (allowed.has("verdict")) out.verdict = { state: view.verdict.state, label: view.verdict.label };

  if (allowed.has("sections")) {
    out.sections = view.sections.map((section) => ({
      id: section.id,
      title: section.title,
      services: section.services.map((s) => ({
        id: s.id,
        state: servicePublicState(s),
        ...(allowed.has("serviceNames") ? { name: s.name } : {}),
        ...(allowed.has("uptime90d") ? { uptime90d: uptime90dOf(s) } : {}),
      })),
    }));
  }

  if (allowed.has("incidentTitles")) {
    out.incidents = [...view.incidents.open, ...view.incidents.recent.slice(0, RESOLVED_INCIDENTS)].map(
      (i) => ({ title: i.title, startedAt: i.startedAt, endedAt: i.endedAt }),
    );
  }

  if (allowed.has("generatedAt")) out.generatedAt = view.generatedAt;
  return out;
}

/** A service of the summary's sections by id, or null when sections are not shared or it is not there. */
export function summaryService(summary: PublicSummary, id: string) {
  for (const section of summary.sections ?? []) {
    const found = section.services.find((s) => s.id === id);
    if (found) return found;
  }
  return null;
}
