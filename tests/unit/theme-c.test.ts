import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlockHeader } from "@/client/kit";
import { THEMES, themeFor } from "@/client/themes";
import { cSession, THEME_COLOR } from "@/client/themes/c-session";
import { findForbiddenLiterals } from "@/shared/model";
import { buildSiteView, type SiteView } from "@/shared/view";
import { FIXTURE_NAMES, type FixtureName } from "../fixtures";
import { fixtureInput } from "../fixtures/view";

const view = (name: FixtureName) => buildSiteView(fixtureInput(name));
const render = (v: SiteView) =>
  renderToStaticMarkup(createElement(cSession.Page, { view: v, commit: "cbe27a13" }));

/** Terminal transplants dropped after the mock-up review (plan section 2): none may reach the page. */
const TRANSPLANTS = ["ACCESS GRANTED", "user@", "❯", "▸"];

const UP_DOT = /role="img" aria-label="[^"]*" data-state="up"/;

/** The topology block ages with the facts probe, not the Kuma collector; cut it out to check the monitor blocks. */
const withoutTopology = (html: string) => html.replace(/<section id="infra"[\s\S]*?<\/section>/, "");

describe("theme C audit", () => {
  it.each(FIXTURE_NAMES)("renders the %s fixture without address, email or token literals", (name) => {
    expect(findForbiddenLiterals(render(view(name)))).toEqual([]);
  });

  it.each(FIXTURE_NAMES)("renders the %s fixture without terminal transplants", (name) => {
    const html = render(view(name));
    for (const t of TRANSPLANTS) expect(html).not.toContain(t);
  });
});

describe("theme C page", () => {
  it("registers as the c-session theme on data-theme c with its base colour", () => {
    expect(cSession).toMatchObject({ id: "c-session", label: "Session", dataTheme: "c" });
    expect(THEMES["c-session"]).toEqual({ module: cSession, themeColor: THEME_COLOR });
    expect(themeFor("c-session").module).toBe(cSession);
    expect(THEME_COLOR).toBe("#050807");
  });

  it("renders every block with a plain header and its command as a muted tag", () => {
    const v = view("default");
    const html = render(v);
    for (const cmd of [
      "status --summary",
      "infra --topology",
      "monitors --inspect api-health",
      "monitors --beats 90d",
      "tail -f activity",
      "incidents --30d",
    ])
      expect(html).toContain(`>${cmd}</code>`);
    for (const s of v.sections.flatMap((x) => x.services)) expect(html).toContain(s.name);
    expect(html).toContain("All <em");
    expect(html).not.toContain("collector --ping");
  });

  it("keeps no green dot on the monitors once the collector is stale", () => {
    expect(withoutTopology(render(view("default")))).toMatch(UP_DOT);
    const html = render(view("stale"));
    expect(withoutTopology(html)).not.toMatch(UP_DOT);
    expect(html).toContain("collector --ping");
    expect(html).toContain("Last known: <em");
    expect(html).toContain("as of 23:57:26");
    expect(html).toContain("no data since 23:57");
    expect(html).toContain('role="alert"');
  });

  it("lets topology follow its own fresh facts probe while the collector is stale", () => {
    const html = render(view("stale"));
    const infra = html.match(/<section id="infra"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(infra).toMatch(UP_DOT);
    expect(infra).toContain('data-live="true"');
  });

  it("renders the incident: failing blocks, the down monitor inspected, the broken edge, the open incident", () => {
    const v = view("incident");
    const html = render(v);
    const incident = v.incidents.open[0]!;
    expect(html).toContain(incident.title);
    expect(html).toContain(">OPEN<");
    expect(html).toContain("1 of 8");
    expect(html).toContain("Inspect: Replica Postgres");
    expect(html).toContain("monitors --inspect replica-postgres");
    expect(html).toContain("pg unreachable");
    expect(html).toContain('data-live="false"');
    expect(html.match(/data-fail="true"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain("No open incidents");
  });

  it("renders a dash for missing facts and survives a site without topology or services", () => {
    const v: SiteView = { ...view("default"), factGroups: [], factIndex: {}, topology: null };
    const html = render(v);
    expect(html).toMatch(/kuma db<\/dt><dd[^>]*>-</);
    expect(html).toMatch(/kuma<\/dt><dd[^>]*>-</);
    expect(html).toContain("No infrastructure facts yet");
    const empty: SiteView = { ...v, sections: [], unsectioned: [], activity: [] };
    const bare = render(empty);
    expect(bare).toContain("No monitors yet");
    expect(bare).toContain("No activity yet");
  });
});

describe("kit BlockHeader", () => {
  const header = (props: Parameters<typeof BlockHeader>[0]) =>
    renderToStaticMarkup(createElement(BlockHeader, props));

  it("renders the title, the command tag and a readable exit badge", () => {
    const html = header({ title: "Beats 90d", command: "monitors --beats 90d", exitCode: 1, id: "h" });
    expect(html).toContain('<h2 id="h"');
    expect(html).toContain(">monitors --beats 90d</code>");
    expect(html).toContain('data-exit="1"');
    expect(html).toContain('<span class="sr-only">exit</span> 1');
    expect(html).toContain("text-down");
  });

  it("mutes the badge for stale data and leaves it out without an exit code", () => {
    expect(header({ title: "Summary", exitCode: 0, stale: true })).toContain("text-faint");
    expect(header({ title: "Activity", aside: "live" })).not.toContain("data-exit");
  });
});
