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
/** The fixture on a site whose config has no topology. */
const unpaired = (name: FixtureName) => {
  const input = fixtureInput(name);
  return buildSiteView({ ...input, config: { ...input.config, topology: undefined } });
};
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
    expect(html).toMatch(/text-down">postgres down</);
    expect(html).toContain('data-live="false"');
    expect(html.match(/data-fail="true"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain("No open incidents");
  });

  it("stamps the fence with the timelines and colours a fine measure on the pair", () => {
    const html = render(view("default"));
    expect(html).toContain("peer is a standby · tl 1/1</span>");
    expect(html).toContain('wal <span class="text-up">lag 0 s</span>');
    expect(html).toContain("postgres replica");
  });

  it("shows a status highlight with its dot and colour, and dots a plain infra line", () => {
    const html = render(view("default"));
    expect(html).toMatch(
      /watchdog<\/dt><dd[^>]*><span data-status="ok" class="[^"]*"><span[^>]*data-state="up"[^>]*><\/span><span class="text-up">reachable \(HTTP 200\)</,
    );
    const infra = html.match(/<section id="infra"[\s\S]*?<\/section>/)?.[0] ?? "";
    const line = (label: string) => {
      const at = infra.indexOf(`>${label}</dt>`);
      return infra.slice(at, infra.indexOf("</dd>", at));
    };
    expect(line("runners")).toMatch(/<dd[^>]*><span[^>]*><span[^>]*data-state="up"/);
    expect(line("forgejo")).toMatch(/<dd[^>]*><span[^>]*><span[^>]*data-state="up"/);
    // Replication is drawn by the pair; without a topology its line starts coloured, so without a dot.
    const plain = render(unpaired("default"));
    const plainInfra = plain.match(/<section id="infra"[\s\S]*?<\/section>/)?.[0] ?? "";
    const at = plainInfra.indexOf(">replication</dt>");
    expect(at).toBeGreaterThan(-1);
    expect(plainInfra.slice(at, plainInfra.indexOf("</dd>", at))).not.toMatch(/data-state=/);
    expect(line("disk")).toContain('role="meter"');
    expect(line("disk")).not.toMatch(/data-state=/);
    const stale = render(view("stale"));
    expect(stale).toMatch(
      /watchdog<\/dt><dd[^>]*><span data-status="ok"[^>]*><span[^>]*data-state="stale"[^>]*><\/span><span>reachable/,
    );
  });

  it("leaves the groups the drawn pair carries out of the infra lines, and lists them without a topology", () => {
    const v = view("default");
    const carried = v.factGroups.filter((g) => g.inTopology).map((g) => g.title.toLowerCase());
    expect(carried).toEqual(["replication", "fence"]);
    const infra = (html: string) => html.match(/<section id="infra"[\s\S]*?<\/section>/)?.[0] ?? "";
    const paired = infra(render(v));
    expect(paired).toContain('data-edge="app-1-app-2"');
    expect(paired).toContain('data-fence="serve"');
    for (const t of carried) expect(paired, t).not.toContain(`>${t}</dt>`);
    expect(paired).toContain(">backup</dt>");
    const plain = infra(render(unpaired("default")));
    for (const t of carried) expect(plain, t).toContain(`>${t}</dt>`);
  });

  it("survives a site without facts, topology or services", () => {
    const v: SiteView = {
      ...view("default"),
      factGroups: [],
      factIndex: {},
      highlights: [],
      headline: null,
      topology: null,
    };
    const html = render(v);
    expect(html).not.toContain(">kuma</dt>");
    expect(html).toContain("All <em");
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
