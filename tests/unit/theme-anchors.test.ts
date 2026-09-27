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

// Kuma reports the latest release, which can be older than a pre-release in use: no theme offers a downgrade.
describe("Kuma update badge", () => {
  const base = buildSiteView(fixtureInput("default"));
  const withLatest = (latest: string) => {
    const row = { ...base.factIndex["kuma.latestVersion"]!, display: latest };
    return { ...base, factIndex: { ...base.factIndex, "kuma.latestVersion": row } };
  };
  it.each(Object.keys(THEMES))("%s shows 'available' only for a newer release", (id) => {
    const Page = THEMES[id as keyof typeof THEMES]!.module.Page;
    const html = (v: typeof base) => renderToStaticMarkup(createElement(Page, { view: v, commit: null }));
    expect(html(withLatest("2.4.0"))).not.toMatch(/2\.4\.0 available/i);
    expect(html(withLatest("2.6.0"))).toMatch(/2\.6\.0 available/i);
  });
});
