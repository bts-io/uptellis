import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aSysStatus } from "@/client/themes/a-sys-status";
import { PROBE_SOURCE_ID } from "@/shared/config";
import { findForbiddenLiterals } from "@/shared/model";
import { buildSiteView } from "@/shared/view";
import { applyResults } from "@/worker/monitors/apply";
import { fixtureConfig, fixtureInput } from "../fixtures/view";
import { memoryMonitors } from "../support/monitors";

// The fixtures hold Kuma and facts data only; this adds what one builtin run writes for sites/demo.json
// (its legacy probes, as monitors on `probe:cf`).
async function withProbes() {
  const input = fixtureInput("default");
  const now = new Date(input.now as string);
  const ts = new Date(now.getTime() - 20_000).toISOString().replace(".000Z", "Z");
  const { backend, store } = memoryMonitors(fixtureConfig);
  await applyResults(
    backend,
    { site: "demo", runner: "builtin", runtime: "cloudflare" },
    [
      { monitorId: "api-health", ts, status: "up", latencyMs: 140, message: "HTTP 200" },
      { monitorId: "web-app", ts, status: "down", latencyMs: 95, message: "HTTP 503" },
    ],
    now,
  );
  input.model.sources = [...input.model.sources, store.sources.get(PROBE_SOURCE_ID)!];
  input.model.services = [...input.model.services, ...store.services.values()];
  input.model.recentHeartbeats = [...input.model.recentHeartbeats, ...store.heartbeats.values()];
  return input;
}

describe("probe services in the view and theme A", () => {
  it("are ordinary services of the web section, after the Kuma ones", async () => {
    const v = buildSiteView(await withProbes());
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

  it("render in theme A without address, email or token literals", async () => {
    const html = renderToStaticMarkup(
      createElement(aSysStatus.Page, { view: buildSiteView(await withProbes()), commit: "cbe27a13" }),
    );
    expect(html).toContain("API health (edge)");
    expect(html).toContain("Web app (edge)");
    expect(html).toContain("example.com/api/healthz");
    expect(findForbiddenLiterals(html)).toEqual([]);
  });
});
