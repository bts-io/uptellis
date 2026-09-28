import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES } from "@/client/themes";
import { THEME_IDS } from "@/shared/config";
import { buildSiteView, type SiteView } from "@/shared/view";
import { fixtureInput } from "../fixtures/view";

const render = (id: (typeof THEME_IDS)[number], view: SiteView) =>
  renderToStaticMarkup(createElement(THEMES[id]!.module.Page, { view, commit: "cbe27a13" }));

const base = buildSiteView(fixtureInput("default"));
const withWindow: SiteView = {
  ...base,
  maintenance: [
    {
      id: "switch",
      title: "Switch replacement",
      services: [],
      start: "2026-09-27T23:00:00Z",
      end: "2026-09-28T01:30:00Z",
    },
  ],
};

describe("maintenance notice in the themes", () => {
  it.each(THEME_IDS)("%s shows the active window with its end", (id) => {
    const html = render(id, withWindow);
    expect(html).toContain("data-maintenance");
    expect(html).toContain("Switch replacement");
    expect(html).toContain("01:30 UTC");
  });

  it.each(THEME_IDS)("%s shows nothing without an active window", (id) => {
    expect(render(id, base)).not.toContain("data-maintenance");
    expect(render(id, { ...base, maintenance: undefined })).not.toContain("data-maintenance");
  });
});
