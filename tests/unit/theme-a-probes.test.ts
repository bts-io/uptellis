import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aSysStatus } from "@/client/themes/a-sys-status";
import { PROBE_SOURCE_ID } from "@/shared/config";
import { findForbiddenLiterals } from "@/shared/model";
import { buildSiteView } from "@/shared/view";
import { normalizeProbes } from "@/worker/adapters/probe";
import { fixtureConfig, fixtureInput } from "../fixtures/view";

// The fixtures hold Kuma and facts data only; this adds what one probe run writes for sites/demo.json.
function withProbes() {
  const input = fixtureInput("default");
  const now = new Date(input.now as string);
  const at = new Date(now.getTime() - 20_000);
  const [health, web] = fixtureConfig.probes;
  const delta = normalizeProbes(
    [
      { probe: health!, result: { status: "up", latencyMs: 140, message: "HTTP 200" } },
      { probe: web!, result: { status: "down", latencyMs: 95, message: "HTTP 503" } },
    ],
    PROBE_SOURCE_ID,
    "demo",
    at,
    now,
  );
  input.model.sources = [
    ...input.model.sources,
    {
      id: PROBE_SOURCE_ID,
      site: "demo",
      kind: "probe",
      expectedIntervalS: 60,
      lastSeenAt: delta.source.seenAt,
      lastOkAt: delta.source.seenAt,
    },
  ];
  input.model.services = [...input.model.services, ...delta.services];
  input.model.recentHeartbeats = [...input.model.recentHeartbeats, ...delta.heartbeats];
  return input;
}

describe("probe services in the view and theme A", () => {
  it("are ordinary services of the web section, after the Kuma ones", () => {
    const v = buildSiteView(withProbes());
    const web = v.sections.find((s) => s.id === "web")!;
    expect(web.services.map((s) => [s.id, s.name, s.state])).toEqual([
      ["kuma:1", "API health", "up"],
      ["kuma:2", "Web app", "up"],
      ["probe:api-health", "API health (edge)", "up"],
      ["probe:web-app", "Web app (edge)", "down"],
    ]);
    expect(web.exitCode).toBe(1);
    expect(v.freshness.perSource.find((p) => p.id === PROBE_SOURCE_ID)?.freshness).toBe("fresh");
    expect(v.unsectioned).toEqual([]);
  });

  it("render in theme A without address, email or token literals", () => {
    const html = renderToStaticMarkup(
      createElement(aSysStatus.Page, { view: buildSiteView(withProbes()), commit: "cbe27a13" }),
    );
    expect(html).toContain("API health (edge)");
    expect(html).toContain("Web app (edge)");
    expect(html).toContain("example.com/api/healthz");
    expect(findForbiddenLiterals(html)).toEqual([]);
  });
});
