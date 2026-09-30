// Fixture model -> `ViewInput` for buildSiteView, the way the read service assembles it from D1 and KV.

import siteJson from "../../sites/demo.json";
import { parseSiteConfig } from "../../src/shared/config";
import { MaintenanceWindow } from "../../src/shared/monitors";
import type { ViewInput } from "../../src/shared/view";
import { FIXTURE_NAMES, loadFixture } from "./index";

export const fixtureConfig = parseSiteConfig(siteJson);

/**
 * The model fixtures plus view-only ones. `maintenance` is the default model under a site-wide maintenance
 * window that is active at its `now` (2026-09-27T23:58:00Z): every service shows as maintenance.
 */
export const VIEW_FIXTURE_NAMES = [...FIXTURE_NAMES, "maintenance"] as const;
export type ViewFixtureName = (typeof VIEW_FIXTURE_NAMES)[number];

/** The site-wide window of the `maintenance` fixture. */
export const SITE_WIDE_WINDOW = MaintenanceWindow.parse({
  kind: "once",
  id: "switch",
  title: "Switch replacement",
  services: [],
  start: "2026-09-27T23:00:00Z",
  end: "2026-09-28T01:30:00Z",
});

export function fixtureInput(name: ViewFixtureName): ViewInput {
  const f = loadFixture(name === "maintenance" ? "default" : name);
  return {
    model: {
      site: f.site.slug,
      generatedAt: f.sources.reduce((n, s) => (s.lastSeenAt && s.lastSeenAt > n ? s.lastSeenAt : n), ""),
      sources: f.sources,
      services: f.services,
      recentHeartbeats: f.heartbeats,
      openIncidents: f.incidents.filter((i) => !i.endedAt),
      recentIncidents: f.incidents.filter((i) => i.endedAt),
      facts: f.facts,
    },
    history: f.history,
    config: name === "maintenance" ? { ...fixtureConfig, maintenance: [SITE_WIDE_WINDOW] } : fixtureConfig,
    now: f.now,
  };
}
