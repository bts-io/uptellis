import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES } from "@/client/themes";
import { MonitorConfig } from "@/shared/monitors";
import { buildSiteView } from "@/shared/view";
import { fixtureInput } from "../fixtures/view";

// A paused monitor that never ran has no row, no beats, no latency and no uptime; the view shows it from its
// config (buildSiteView). Every theme renders it, once, with its name and the word for paused.
describe("a paused monitor with no data", () => {
  const input = fixtureInput("default");
  input.config = {
    ...input.config,
    monitors: [
      MonitorConfig.parse({
        id: "lab-ping",
        name: "Lab machine ping",
        type: "ping",
        host: "lab.example.com",
        runners: ["office-1"],
        enabled: false,
      }),
    ],
    sections: [...input.config.sections, { id: "lab", title: "Lab", services: ["probe:lab-ping"] }],
  };
  const view = buildSiteView(input);

  it.each(Object.keys(THEMES))("%s renders it as paused", (id) => {
    const theme = THEMES[id as keyof typeof THEMES]!;
    const html = renderToStaticMarkup(createElement(theme.module.Page, { view, commit: null }));
    expect(html.split(`id="svc-probe:lab-ping"`).length - 1).toBe(1);
    // The service's own markup, from its anchor to the next service's.
    const from = html.indexOf(`id="svc-probe:lab-ping"`);
    const next = html.indexOf(`id="svc-`, from + 1);
    const own = html.slice(from, next === -1 ? undefined : next);
    // Visible text only: a class name like `bg-(--d-paused)` is not the word.
    const text = own.replace(/<[^>]*>/g, " ");
    expect(text).toContain("Lab machine ping");
    expect(text).toMatch(/\bpaused\b/i);
  });
});
