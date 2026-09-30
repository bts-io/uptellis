import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KIT_FONTS, THEMES, themeFor } from "@/client/themes";
import { bControlRoom, THEME_COLOR } from "@/client/themes/b-control-room";
import { combinedBeats } from "@/client/themes/b-control-room/format";
import { Kpis } from "@/client/themes/b-control-room/Kpis";
import { MonitorTile } from "@/client/themes/b-control-room/MonitorTile";
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
  renderToStaticMarkup(createElement(bControlRoom.Page, { view: v, commit: "cbe27a13" }));
const services = (v: SiteView) => v.sections.flatMap((s) => s.services);

/** Terminal transplants dropped after the mock-up review (plan section 2), and the palette chip. */
const TRANSPLANTS = ["ACCESS GRANTED", "user@", "❯", "▸", "tail -f", "⌘K"];

const UP_DOT = /role="img" aria-label="[^"]*" data-state="up"/;

describe("theme B audit", () => {
  it.each(FIXTURE_NAMES)("renders the %s fixture without address, email or token literals", (name) => {
    expect(findForbiddenLiterals(render(view(name)))).toEqual([]);
  });

  it.each(FIXTURE_NAMES)("renders the %s fixture without terminal transplants", (name) => {
    const html = render(view(name));
    for (const t of TRANSPLANTS) expect(html).not.toContain(t);
  });
});

describe("theme B page", () => {
  it("registers as b-control-room on data-theme b with its base colour", () => {
    expect(bControlRoom).toMatchObject({ id: "b-control-room", label: "Control Room", dataTheme: "b" });
    expect(THEMES["b-control-room"]).toEqual({
      module: bControlRoom,
      themeColor: THEME_COLOR,
      fonts: KIT_FONTS,
    });
    expect(themeFor("b-control-room").module).toBe(bControlRoom);
    expect(THEME_COLOR).toBe("#0a0c10");
  });

  it("renders every monitor tile, the summary strip and the tiles", () => {
    const v = view("default");
    const html = render(v);
    for (const s of services(v)) expect(html).toContain(s.name);
    // One tile per fact group the KPI strip does not already show, titled by its profile.
    const groups = ["Forgejo", "Replication", "Fence", "Backup", "Runners", "Disk"];
    for (const t of ["Topology", "Response time", ...groups, "Tailnet", "Incidents"])
      expect(html).toContain(t);
    expect(html).toContain("All systems operational");
    expect(html.replace(/<[^>]+>/g, "")).toContain("16.0.5 · HTTP 200 · serving app-1");
    expect(html).toMatch(/<span data-level="ok" class="text-up">HTTP 200<\/span>/);
    expect(html).toContain("streaming");
    expect(html.match(/data-check=/g)).toHaveLength(12);
  });

  it("keeps the topology before the monitors in document order (the phone order)", () => {
    const html = render(view("default"));
    expect(html.indexOf('id="infra"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="infra"')).toBeLessThan(html.indexOf('id="monitors"'));
  });

  it("keeps no green dot on the stale fixture's monitors and summary", () => {
    const tiles = (v: SiteView, stale: boolean) =>
      services(v)
        .map((s) =>
          renderToStaticMarkup(createElement(MonitorTile, { service: s, stale, generatedAt: v.generatedAt })),
        )
        .join("");
    const kpis = (v: SiteView) => renderToStaticMarkup(createElement(Kpis, { view: v }));
    expect(tiles(view("default"), false)).toMatch(UP_DOT);
    expect(kpis(view("default"))).toMatch(UP_DOT);
    const stale = view("stale");
    expect(tiles(stale, true)).not.toMatch(UP_DOT);
    expect(kpis(stale)).not.toMatch(UP_DOT);
    expect(services(stale).every((s) => s.state === "stale")).toBe(true);
  });

  it("marks frozen values and pauses the chart once the data is stale", () => {
    const html = render(view("stale"));
    expect(html).toContain("SNAPSHOT STALE");
    expect(html).toContain("@23:57");
    expect(html).toContain("as of 23:57");
    expect(html).toContain("paused");
    expect(html).toContain("8 stale");
  });

  it("shows the open incident, the down tile and the broken replication link", () => {
    const v = view("incident");
    const html = render(v);
    expect(v.incidents.open).toHaveLength(1);
    expect(html).toContain(v.incidents.open[0]!.title);
    expect(html).toContain("partial outage: Replica Postgres");
    expect(html).toContain("timeout");
    expect(html).toContain("replication stopped");
    expect(html).toMatch(/>wal<\/span><b[^>]*>(?:(?!<\/b>).)*text-down">stopped</);
    expect(html).toMatch(/data-live="false"/);
    expect(html).toContain('data-check="down"');
    // The chart opens on the section with the failing service.
    expect(html).toMatch(/aria-selected="true"[^>]*>Database</);
  });

  it("captions the pair from the profile and colours the standby's lag and the fence cell", () => {
    const html = render(view("default"));
    expect(html).toContain(">Forgejo failover pair<");
    // The standby's wal row reads green (a fine measure); words stay ink.
    expect(html).toMatch(
      /<span>wal<\/span><b[^>]*><span[^>]*data-state="up"[^>]*><\/span><span class="text-up">lag 0 s</,
    );
    expect(html).toMatch(/<span>postgres<\/span><b[^>]*><span[^>]*><\/span><span>replica</);
    // The fence cell: the decision in its level's colour, the profile's timelines muted.
    expect(html).toMatch(
      /<span class="uppercase text-up">serve<\/span><span class="text-muted"> · tl 1\/1<\/span>/,
    );
    const bare = view("default");
    bare.topology = { ...bare.topology!, nodes: bare.topology!.nodes.map((n) => ({ ...n, details: [] })) };
    expect(render(bare)).toContain(">Failover pair<");
  });

  it("shows a status highlight in the strip with its dot and colour, and no empty detail", () => {
    const kpis = (v: SiteView) => renderToStaticMarkup(createElement(Kpis, { view: v }));
    const html = kpis(view("default"));
    expect(html).toMatch(
      /watchdog<\/span><div data-status="ok" class="[^"]*text-up[^"]*"><span[^>]*><span[^>]*data-state="up"[^>]*><\/span><\/span>reachable \(HTTP 200\)<\/div><\/div>/,
    );
    // The kuma slot keeps its value, badge and detail.
    expect(html).toMatch(/>kuma<\/span>.*?2\.5\.5.*?latest.*?db 41\.2 MB/);
    expect(kpis(view("stale"))).toMatch(
      /data-status="ok" class="(?![^"]*text-up)[^"]*"><span[^>]*><span[^>]*data-state="stale"/,
    );
  });

  it("wraps each group tile's summary with its dot and colours a warning row", () => {
    // Without a topology the pair's groups (replication, fence) have tiles of their own.
    const html = render(unpaired("default"));
    // The group tiles follow the topology, whose facts row has cells of the same names.
    const tile = (title: string) => {
      const at = html.lastIndexOf(`uppercase">${title}</span>`);
      return html.slice(at, html.indexOf("</section>", at));
    };
    // Each tile states its level; a summary line wraps instead of truncating.
    expect(tile("Runners")).toMatch(/text-up">ok<\/span>/);
    expect(tile("Replication")).not.toContain("block truncate");
    expect(tile("Replication")).toContain("[overflow-wrap:anywhere]");
    // A line that starts plain takes the group's dot; one that starts coloured does not.
    expect(tile("Runners")).toMatch(
      /\[overflow-wrap:anywhere\]"><span class="mr-2 inline-flex align-middle"><span[^>]*data-state="up"/,
    );
    expect(tile("Forgejo")).toMatch(/\[overflow-wrap:anywhere\]"><span class="mr-2 inline-flex/);
    expect(tile("Replication")).not.toMatch(/\[overflow-wrap:anywhere\]"><span class="mr-2 inline-flex/);
    const inc = render(unpaired("incident"));
    const at = inc.lastIndexOf('uppercase">Replication</span>');
    const repl = inc.slice(at, inc.indexOf("</section>", at));
    expect(repl).toMatch(/text-degraded">warning</);
    expect(repl).toMatch(
      />state<\/span><span[^>]*><span[^>]*data-state="degraded"[^>]*><\/span><span class="truncate text-degraded">none</,
    );
  });

  it("leaves the groups the drawn pair carries out of the group tiles, and tiles them without a topology", () => {
    const v = view("default");
    const carried = v.factGroups.filter((g) => g.inTopology);
    expect(carried.map((g) => g.id)).toEqual(["replication", "fence"]);
    const text = (html: string) => html.replace(/<[^>]+>/g, "");
    const paired = render(v);
    // The pair draws them: the WAL stream with its lag, the fence stamp.
    expect(paired).toContain('data-edge="app-1-app-2"');
    expect(paired).toMatch(/<span>Fence<\/span><b[^>]*>serve<\/b>/);
    // Only a group tile shows the summary line.
    const plain = render(unpaired("default"));
    for (const g of carried) {
      expect(text(paired), g.id).not.toContain(g.summary);
      expect(text(plain), g.id).toContain(g.summary);
    }
    expect(text(paired)).toContain(v.factGroups.find((g) => g.id === "backup")!.summary);
  });

  it("survives a site without facts or topology", () => {
    const v: SiteView = {
      ...view("default"),
      factGroups: [],
      factIndex: {},
      highlights: [],
      headline: null,
      topology: null,
      activity: [],
    };
    const html = render(v);
    expect(html).toContain("No infrastructure facts yet");
    expect(html).toContain("Tailnet");
    expect(html).not.toContain(">Forgejo<");
  });

  it("combines the 90-day bars by each day's worst state", () => {
    const days = combinedBeats(services(view("default")));
    expect(days).toHaveLength(90);
    expect(days.filter((d) => d.worst === "down").map((d) => d.day)).toEqual(["2026-09-15", "2026-09-16"]);
    expect(days.find((d) => d.day === "2026-09-25")?.worst).toBe("degraded");
  });
});
