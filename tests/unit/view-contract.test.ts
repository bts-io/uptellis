import { describe, expect, it } from "vitest";
import { buildSiteView } from "../../src/shared/view";
import { fixtureConfig as config, fixtureInput, VIEW_FIXTURE_NAMES } from "../fixtures/view";

describe("SiteView contract", () => {
  it.each(VIEW_FIXTURE_NAMES)("builds a complete view from the %s fixture", (name) => {
    const v = buildSiteView(fixtureInput(name));
    expect(v.v).toBe(1);
    expect(v.sections.map((s) => s.id)).toEqual(config.sections.map((s) => s.id));
    expect(v.sections.flatMap((s) => s.services)).toHaveLength(8);
    for (const s of v.sections.flatMap((x) => x.services)) {
      expect(s.beats90d).toHaveLength(90);
      expect(s.beatsText).toHaveLength(90);
    }
    expect(v.freshness.perSource.map((s) => s.id)).toEqual(["kuma:watch-1", "facts:app-1", "probe:cf"]);
  });

  it("maps the fixtures to their verdicts", () => {
    expect(buildSiteView(fixtureInput("default")).verdict.state).toBe("operational");
    expect(buildSiteView(fixtureInput("stale")).verdict.state).toBe("stale");
    expect(buildSiteView(fixtureInput("incident")).verdict.state).toBe("outage");
    expect(buildSiteView(fixtureInput("maintenance")).verdict.state).toBe("maintenance");
  });

  it("is deterministic", () => {
    expect(buildSiteView(fixtureInput("incident"))).toEqual(buildSiteView(fixtureInput("incident")));
  });
});
