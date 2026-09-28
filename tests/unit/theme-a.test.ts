import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aSysStatus } from "@/client/themes/a-sys-status";
import { MonitorsPanel } from "@/client/themes/a-sys-status/MonitorsPanel";
import { findForbiddenLiterals } from "@/shared/model";
import { buildSiteView, isNewer, type SiteView } from "@/shared/view";
import { FIXTURE_NAMES, type FixtureName } from "../fixtures";
import { fixtureInput } from "../fixtures/view";

const view = (name: FixtureName) => buildSiteView(fixtureInput(name));
const render = (v: SiteView) =>
  renderToStaticMarkup(createElement(aSysStatus.Page, { view: v, commit: "cbe27a13" }));

/** Terminal transplants dropped after the mock-up review (plan section 2): none may reach the page. */
const TRANSPLANTS = ["ACCESS GRANTED", "user@", "❯", "▸", "tail -f", "⌘K"];

describe("theme A audit", () => {
  it.each(FIXTURE_NAMES)("renders the %s fixture without address, email or token literals", (name) => {
    const html = render(view(name));
    expect(findForbiddenLiterals(html)).toEqual([]);
  });

  it.each(FIXTURE_NAMES)("renders the %s fixture without terminal transplants", (name) => {
    const html = render(view(name));
    for (const t of TRANSPLANTS) expect(html).not.toContain(t);
  });
});

describe("theme A page", () => {
  it("registers as the a-sys-status theme on data-theme a", () => {
    expect(aSysStatus).toMatchObject({ id: "a-sys-status", dataTheme: "a" });
  });

  it("renders every service card, the summary box and the panels", () => {
    const v = view("default");
    const html = render(v);
    for (const s of v.sections.flatMap((x) => x.services)) expect(html).toContain(s.name);
    for (const title of ["sys.status", "monitors", "infra", "hosts", "activity"])
      expect(html).toContain(title);
    expect(html).toContain("collector watch-1");
    // The summary box's highlight slots: the Kuma version with its note, the collector, the watchdog.
    expect(html).toMatch(/>kuma<\/dt><dd[^>]*><span>2\.5\.5<\/span><span class="text-xs text-up">latest</);
    expect(html).toMatch(
      /latest<\/span><span class="text-faint">·<\/span><span class="text-muted">db 41\.2 MB</,
    );
    expect(html).toContain("Asia/Tokyo");
    expect(html).toContain("reachable (HTTP 200)");
    expect(html).toContain("8/8 up");
  });

  it("reads the summary box in slot order: kuma, then collector and watchdog around the snapshot", () => {
    const html = render(view("default"));
    const labels = [...html.matchAll(/<dt[^>]*>(?:<svg.*?<\/svg>)?(?:<span[^>]*>)?([a-z0-9 ]+)</g)].map(
      (m) => m[1],
    );
    const box = labels.slice(0, 9);
    expect(box).toEqual([
      "monitors",
      "avg resp",
      "kuma",
      "health",
      "uptime 24h",
      "uptime 30d",
      "collector",
      "snapshot",
      "watchdog",
    ]);
    // The watchdog is a lone status: it takes its dot.
    expect(html).toMatch(/>watchdog<\/dt><dd[^>]*><span[^>]*><span role="img" aria-label="up"/);
  });

  it("names what it reads in the header subline, from the first highlight slot", () => {
    const html = render(view("default"));
    expect(html).toMatch(/<p class="mt-2 text-xs text-muted">acme cloud · kuma 2\.5\.5 on watch-1<\/p>/);
  });

  it("stamps the fence with the timelines", () => {
    expect(render(view("default"))).toContain("tl 1/1 · peer is a standby · 23:45");
  });

  it("colours the infra rows part by part, with the group's dot where the line starts plain", () => {
    const html = render(view("default"));
    /** The markup of one infra row's value, from its title to the end of the row. */
    const row = (title: string) => {
      const at = html.indexOf(`text-accent lowercase">${title}</span>`);
      return html.slice(at, html.indexOf("</div></div>", at));
    };
    // forgejo: the group's dot, the version plain, HTTP 200 green, the rest muted.
    expect(row("Forgejo")).toMatch(
      /data-state="up"[^>]*><\/span><\/span><span><span>16\.0\.5<\/span> <span data-level="info" class="text-muted">·<\/span> <span data-level="ok" class="text-up">HTTP 200<\/span>/,
    );
    expect(row("Replication")).toMatch(
      /<span data-level="ok" class="text-up font-semibold">streaming<\/span>/,
    );
    expect(row("Fence")).toMatch(/<span data-level="ok" class="text-up font-semibold">SERVE<\/span>/);
    expect(row("Disk")).toMatch(/<span data-level="ok" class="text-up">12G \/ 79G \(16%\)<\/span>/);
    expect(row("Runners")).toContain("offline none");
    // A line that starts plain takes the group's dot; one that starts coloured, or with a gauge, does not.
    for (const [title, dots] of [
      ["Forgejo", 1],
      ["Replication", 0],
      ["Fence", 0],
      ["Backup", 0],
      ["Runners", 1],
      ["Disk", 0],
    ] as const)
      expect(row(title).match(/role="img" aria-label="[^"]*" data-state=/g)?.length ?? 0, title).toBe(dots);
    const inc = render(view("incident"));
    expect(inc).toMatch(/<span data-level="warn" class="text-degraded font-semibold">none<\/span>/);
    expect(inc).toMatch(/<span data-level="warn" class="text-degraded">\(reachable no\)<\/span>/);
  });

  it("keeps infra before monitors in document order (the phone order)", () => {
    const html = render(view("default"));
    expect(html.indexOf('id="infra"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="infra"')).toBeLessThan(html.indexOf('id="monitors"'));
  });

  it("marks every card as last known state once the data is stale", () => {
    const html = render(view("stale"));
    expect(html).toContain("last up");
    expect(html).toContain("as of 23:57");
    expect(html).toContain("8 stale");
  });

  it("keeps no green state dot on stale data", () => {
    const upDot = /role="img" aria-label="[^"]*" data-state="up"/;
    // The monitors panel ages with the Kuma collector; infra and hosts follow their own (fresh) facts probe.
    const monitors = (v: SiteView) => renderToStaticMarkup(createElement(MonitorsPanel, { view: v }));
    expect(monitors(view("default"))).toMatch(upDot);
    expect(monitors(view("stale"))).not.toMatch(upDot);
    expect(
      view("stale")
        .sections.flatMap((x) => x.services)
        .every((x) => x.state === "stale"),
    ).toBe(true);
  });

  it("shows the open incident and the down card in the incident fixture", () => {
    const v = view("incident");
    const html = render(v);
    expect(v.incidents.open).toHaveLength(1);
    expect(html).toContain(v.incidents.open[0]!.title);
    expect(html).toContain("timeout");
    expect(html).toContain("7/8 up");
  });

  it("fills the pair cards from the node details: serving, postgres role, disk, and the standby down in an incident", () => {
    const html = render(view("default"));
    expect(html).toContain("failover pair");
    expect(html).toContain("replica");
    expect(html).toContain("16%");
    expect(html).toContain("peer is a standby · 23:45");
    const inc = render(view("incident"));
    expect(inc).toMatch(/postgres<b class="[^"]*text-down/);
    expect(inc).toContain("no standby streaming");
  });

  it("tails the latest checks after the recent events in the activity panel", () => {
    const v = view("incident");
    const html = render(v);
    const panel = html.slice(html.indexOf(">activity<"));
    // The open incident is the only event of the last day; older ones leave their rows to the checks.
    expect(panel.match(/data-level=/g)).toHaveLength(1);
    expect(panel.match(/data-check=/g)).toHaveLength(11);
    const newest = [...v.sections.flatMap((s) => s.services)]
      .flatMap((s) => s.recent)
      .reduce((a, b) => (a.ts > b.ts ? a : b));
    expect(panel).toContain(newest.ts.slice(11, 19));
    expect(render(view("default"))).not.toContain("No activity yet");
  });

  it("renders a dash for missing facts and survives a site without topology", () => {
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
    expect(html).toContain("sys.status");
    expect(html).not.toContain(">kuma</dt>");
    expect(html).toContain("No infrastructure facts yet");
  });

  it("offers a Kuma update only when the latest release is newer", () => {
    expect(isNewer("2.6.0", "2.5.5")).toBe(true);
    expect(isNewer("2.4.0", "2.5.5")).toBe(false);
    expect(isNewer("2.5.5", "2.5.5")).toBe(false);
    expect(isNewer("2.10.0", "2.9.9")).toBe(true);
  });
});
