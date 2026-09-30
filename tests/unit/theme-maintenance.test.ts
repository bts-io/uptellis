import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES } from "@/client/themes";
import type { ThemeId } from "@/shared/config";
import { buildSiteView, type SiteView } from "@/shared/view";
import { fixtureInput } from "../fixtures/view";

const registered = Object.keys(THEMES) as ThemeId[];
const render = (id: ThemeId, view: SiteView) =>
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
  it.each(registered)("%s shows the active window with its end", (id) => {
    const html = render(id, withWindow);
    expect(html).toContain("data-maintenance");
    expect(html).toContain("Switch replacement");
    expect(html).toContain("01:30 UTC");
  });

  it.each(registered)("%s shows nothing without an active window", (id) => {
    expect(render(id, base)).not.toContain("data-maintenance");
    expect(render(id, { ...base, maintenance: undefined })).not.toContain("data-maintenance");
  });
});

/** The page's visible text: tags dropped, whitespace collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("every service in maintenance (site-wide window)", () => {
  const all = buildSiteView(fixtureInput("maintenance"));

  it("builds the maintenance verdict", () => {
    expect(all.verdict.state).toBe("maintenance");
    expect(all.summary.up).toBe(0);
  });

  it.each(registered)("%s shows the maintenance verdict", (id) => {
    const html = render(id, all);
    expect(html).toMatch(/data-state="maintenance"/);
    expect(text(html)).toContain(all.verdict.label);
  });

  it.each(registered)("%s claims nothing is up", (id) => {
    const t = text(render(id, all));
    expect(t).not.toMatch(/all systems operational/i);
    expect(t).not.toMatch(/running smoothly/i);
    expect(t).not.toMatch(/up and answering/i);
    expect(t).not.toMatch(/\ball (?:the )?\d+ [^.]{0,40}?\bup\b/i);
  });
});

describe("checks without a latency outside an outage", () => {
  // Every service in maintenance with no latency, and its recent checks too: nothing reads as a failure.
  const quiet: SiteView = (() => {
    const v = buildSiteView(fixtureInput("maintenance"));
    for (const s of [...v.sections.flatMap((x) => x.services), ...v.unsectioned]) {
      s.latencyMs = null;
      s.recent = s.recent.map((b) => ({ ...b, status: "maintenance", latencyMs: null }));
    }
    return v;
  })();

  it.each(registered)("%s never says timeout or no response for them", (id) => {
    const html = render(id, quiet).toLowerCase();
    expect(html).not.toMatch(/>\s*timeout\s*</);
    expect(html).not.toContain("no response");
  });
});
