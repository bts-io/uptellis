// Fixture model -> `ViewInput` for buildSiteView, the way the read service assembles it from D1 and KV.

import siteJson from "../../sites/demo.json";
import { parseSiteConfig } from "../../src/shared/config";
import type { ViewInput } from "../../src/shared/view";
import { type FixtureName, loadFixture } from "./index";

export const fixtureConfig = parseSiteConfig(siteJson);

export function fixtureInput(name: FixtureName): ViewInput {
  const f = loadFixture(name);
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
    config: fixtureConfig,
    now: f.now,
  };
}
