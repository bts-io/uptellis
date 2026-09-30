import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES } from "@/client/themes";
import { buildSiteView } from "@/shared/view";
import { fixtureInput } from "../fixtures/view";

// The palette's "jump to service" targets `#svc-<service id>`: every theme renders each anchor exactly once.
describe("service anchors", () => {
  const view = buildSiteView(fixtureInput("default"));
  const ids = view.sections.flatMap((s) => s.services.map((x) => x.id));
  it.each(Object.keys(THEMES))("%s renders one svc anchor per service", (id) => {
    const theme = THEMES[id as keyof typeof THEMES]!;
    const html = renderToStaticMarkup(createElement(theme.module.Page, { view, commit: null }));
    for (const s of ids) expect(html.split(`id="svc-${s}"`).length - 1).toBe(1);
  });
});

// Kuma reports the latest release, which can be older than a pre-release in use: the uptime-kuma profile's
// highlight note offers an update only for a newer release, and every theme shows that note as its badge.
describe("Kuma update badge", () => {
  const withLatest = (latest: string) => {
    const input = fixtureInput("default");
    input.model.facts = input.model.facts.map((f) =>
      f.group === "kuma" && f.key === "latestVersion"
        ? { ...f, value: { type: "string", value: latest }, severity: "info" }
        : f,
    );
    return buildSiteView(input);
  };

  it("comes from the kuma version highlight's note, never offering an older release", () => {
    const note = (latest: string) => withLatest(latest).highlights.find((h) => h.row.key === "version")?.note;
    expect(note("2.6.0")).toEqual({ text: "2.6.0 available", level: "warn" });
    expect(note("2.4.0")).toEqual({ text: "latest", level: "ok" });
    expect(note("2.5.5")).toEqual({ text: "latest", level: "ok" });
  });

  it.each(Object.keys(THEMES))("%s shows the note: 'available' only for a newer release", (id) => {
    const Page = THEMES[id as keyof typeof THEMES]!.module.Page;
    const html = (latest: string) =>
      renderToStaticMarkup(createElement(Page, { view: withLatest(latest), commit: null }));
    expect(html("2.4.0")).not.toMatch(/2\.4\.0 available/i);
    expect(html("2.4.0")).toMatch(/latest/i);
    expect(html("2.6.0")).toMatch(/2\.6\.0 available/i);
  });
});

// A section whose services are all missing from the model is left out of the view (buildSiteView), so no
// theme renders an empty header for it.
describe("sections without services", () => {
  const input = fixtureInput("default");
  input.config = {
    ...input.config,
    sections: [...input.config.sections, { id: "ghost", title: "Ghost Section", services: ["kuma:404"] }],
  };
  const view = buildSiteView(input);
  it.each(Object.keys(THEMES))("%s renders no header for a section with nothing in it", (id) => {
    const theme = THEMES[id as keyof typeof THEMES]!;
    const html = renderToStaticMarkup(createElement(theme.module.Page, { view, commit: null }));
    expect(html.toLowerCase()).not.toContain("ghost section");
  });
});
