/**
 * A push monitor's service on the page: the fixture site plus one push monitor in the web section, with what
 * a push writes (through `applyResults` as runner `push`). It renders in every registered theme, shows its
 * stored status however long ago the last push was (never `stale`), and its push token appears nowhere: not
 * in the view, the public summary or the HTML.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES } from "@/client/themes";
import { PUBLIC_FIELDS, parseSiteConfig, type ThemeId } from "@/shared/config";
import { findForbiddenLiterals } from "@/shared/model";
import { MonitorConfig, PUSH_RUNNER, PUSH_SOURCE_ID } from "@/shared/monitors";
import { buildSiteView, type ViewInput } from "@/shared/view";
import { randomToken } from "@/worker/auth/tokens";
import { applyResults } from "@/worker/monitors/apply";
import { buildPublicSummary } from "@/worker/public/summary";
import { fixtureConfig, fixtureInput } from "../fixtures/view";
import { memoryMonitors } from "../support/monitors";

const registered = Object.keys(THEMES) as ThemeId[];
// A token as the admin issues one; the page has no way to know it, and it must never show up.
const TOKEN = randomToken();

const config = parseSiteConfig({
  ...fixtureConfig,
  monitors: [
    ...fixtureConfig.monitors,
    MonitorConfig.parse({ id: "backup", name: "Nightly backup", type: "push", intervalS: 3600, graceS: 600 }),
  ],
  sections: fixtureConfig.sections.map((s) =>
    s.id === "web" ? { ...s, services: [...s.services, "probe:backup"] } : s,
  ),
});

/** The default fixture with one push (`status`) 20 s before its `now`, viewed `laterMs` after that. */
async function withPush(status: "up" | "down", laterMs = 0): Promise<ViewInput> {
  const input = fixtureInput("default");
  const now = new Date(input.now as string);
  const ts = new Date(now.getTime() - 20_000).toISOString().replace(".000Z", "Z");
  const { backend, store } = memoryMonitors(config);
  await applyResults(
    backend,
    { site: "demo", runner: PUSH_RUNNER, runtime: "cloudflare" },
    [
      {
        monitorId: "backup",
        ts,
        status,
        latencyMs: status === "up" ? 12 : null,
        message: status === "up" ? "OK" : "disk full",
      },
    ],
    now,
  );
  input.config = config;
  input.model.sources = [...input.model.sources, store.sources.get(PUSH_SOURCE_ID)!];
  input.model.services = [...input.model.services, ...store.services.values()];
  input.model.recentHeartbeats = [...input.model.recentHeartbeats, ...store.heartbeats.values()];
  input.now = new Date(now.getTime() + laterMs).toISOString();
  return input;
}

const serviceOf = (input: ViewInput) =>
  buildSiteView(input)
    .sections.find((s) => s.id === "web")!
    .services.find((s) => s.id === "probe:backup")!;

describe("push monitors in the view", () => {
  it("are ordinary services of their section, with their schedule as the target", async () => {
    const s = serviceOf(await withPush("up"));
    expect(s).toMatchObject({ name: "Nightly backup", state: "up", kind: "push" });
    expect(JSON.stringify(s)).toContain("heartbeat every 1 h");
  });

  it("keep their stored status however long the push source has been quiet", async () => {
    expect(serviceOf(await withPush("up", 3 * 3600_000)).state).toBe("up");
    expect(serviceOf(await withPush("down", 3 * 3600_000)).state).toBe("down");
  });

  it("carry no token in the view or the public summary", async () => {
    const view = buildSiteView(await withPush("down"));
    const summary = buildPublicSummary(view, PUBLIC_FIELDS);
    expect(JSON.stringify(summary)).toContain("Nightly backup");
    for (const text of [JSON.stringify(view), JSON.stringify(summary)]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("/api/push/");
    }
  });
});

describe("push monitors in every registered theme", () => {
  it.each(registered)("%s renders the push service without errors or forbidden literals", async (id) => {
    for (const status of ["up", "down"] as const) {
      const html = renderToStaticMarkup(
        createElement(THEMES[id]!.module.Page, {
          view: buildSiteView(await withPush(status)),
          commit: "cbe27a13",
        }),
      );
      expect(html).toContain("Nightly backup");
      expect(html).not.toContain(TOKEN);
      expect(html).not.toContain("/api/push/");
      expect(findForbiddenLiterals(html)).toEqual([]);
    }
  });
});
