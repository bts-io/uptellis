// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEMES, themeFor } from "@/client/themes";
import { FONTS, gWallboard, THEME_COLOR } from "@/client/themes/g-wallboard";
import { Board } from "@/client/themes/g-wallboard/Board";
import {
  ago,
  alertPlan,
  boardGroups,
  paginate,
  pct,
  startPage,
  until,
} from "@/client/themes/g-wallboard/format";
import { findForbiddenLiterals } from "@/shared/model";
import { buildSiteView, type SiteView } from "@/shared/view";
import { FIXTURE_NAMES, type FixtureName } from "../fixtures";
import { fixtureInput } from "../fixtures/view";

const view = (name: FixtureName) => buildSiteView(fixtureInput(name));
const render = (v: SiteView) =>
  renderToStaticMarkup(createElement(gWallboard.Page, { view: v, commit: "cbe27a13" }));
/** En and em dashes, spelled as code points so this file carries neither. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const services = (v: SiteView) => v.sections.flatMap((s) => s.services);
/** The tile of one service (its `<li>` up to the next tile or the end of its list). */
const tile = (html: string, id: string) => html.slice(html.indexOf(`id="svc-${id}"`)).split("</li>")[0]!;

describe("theme G audit", () => {
  it.each(FIXTURE_NAMES)("renders the %s fixture without address, email or token literals", (name) => {
    expect(findForbiddenLiterals(render(view(name)))).toEqual([]);
  });

  it.each(FIXTURE_NAMES)("renders the %s fixture without em or en dashes", (name) => {
    expect(render(view(name))).not.toMatch(DASHES);
  });
});

describe("theme G page", () => {
  it("registers as g-wallboard on data-theme g with its base colour", () => {
    expect(gWallboard).toMatchObject({ id: "g-wallboard", label: "Wallboard", dataTheme: "g" });
    expect(THEMES["g-wallboard"]).toEqual({ module: gWallboard, themeColor: THEME_COLOR, fonts: FONTS });
    expect(themeFor("g-wallboard").module).toBe(gWallboard);
    expect(THEME_COLOR).toBe("#07090d");
  });

  it("healthy: the verdict, a tile per service, every section and the infra, no alerts", () => {
    const v = view("default");
    const html = render(v);
    expect(html).toContain("All systems operational");
    expect(text(html)).toContain("8 of 8 up · 99.95% uptime 30 days");
    expect(html).toContain("Updated 34 s ago");
    for (const s of services(v)) expect(tile(html, s.id)).toContain(s.name);
    expect(html.match(/<li id="svc-[^"]+" data-state="up"/g)).toHaveLength(8);
    for (const s of v.sections) expect(html).toContain(`aria-label="${s.title}"`);
    expect(html).toContain('aria-label="Infrastructure"');
    expect(html).not.toMatch(/role="alert"|data-maintenance/);
    // Footer: the headline, the highlights with their badge.
    expect(html).toContain("Forgejo serving from app-1, replication streaming");
    expect(text(html)).toMatch(/kuma 2\.5\.5 · db 41\.2 MB latest/);
    expect(html).toContain("Recent incidents");
    expect(html).toContain("lasted 18 min");
  });

  it("incident: the open incident alert, the down tile and the section in the verdict colours", () => {
    const v = view("incident");
    const html = render(v);
    const [open] = v.incidents.open;
    expect(html).toContain('data-state="outage"');
    expect(html).toContain("1 service down");
    expect(text(html)).toContain(
      `Open incident ${open!.title} Replica Postgres · for 6 min · since 23:52 UTC`,
    );
    const down = tile(html, "kuma:5");
    expect(down).toContain('data-state="down"');
    expect(down).toContain("Down");
    expect(down).toContain("No response");
    expect(html).toMatch(/aria-label="Database"[^>]*>(?:(?!<\/section>).)*>Down</);
  });

  it("keeps each figure whole on the down tile (never '99.85%' on one line and '30 d' on the next)", () => {
    const down = tile(render(view("incident")), "kuma:5");
    const figures = [...down.matchAll(/<span data-figure="" class="([^"]*)">(.*?)<\/span>/g)];
    expect(figures.map((f) => text(f[2]!).trim())).toEqual(["No response", "99.85% 30 d", "90 days"]);
    for (const f of figures) expect(f[1]).toContain("whitespace-nowrap");
    // The row wraps between figures instead.
    expect(down).toMatch(/<p class="flex flex-wrap/);
  });

  it("stale: says so in the band, the alert and the header; no tile reads green", () => {
    const v = view("stale");
    const html = render(v);
    expect(html).toContain('data-state="stale"');
    expect(html).toContain("Data is stale");
    expect(text(html)).toContain("8 services, states below are last known");
    expect(text(html)).toContain("Stale data Data is 14 min old");
    expect(text(html)).toContain("Not reporting: kuma:watch-1, probe:cf · last snapshot 23:57 UTC");
    expect(html).toContain("Stale: last data 14 min ago");
    expect(html).not.toMatch(/<li id="svc-[^"]+" data-state="up"/);
    expect(html.match(/<li id="svc-[^"]+" data-state="stale"/g)).toHaveLength(8);
  });

  it("maintenance: names the covered services and the end, with the date when it is not today", () => {
    const base = view("default");
    const v: SiteView = {
      ...base,
      maintenance: [
        {
          id: "db",
          title: "Postgres upgrade",
          services: ["kuma:3", "kuma:5"],
          start: "2026-09-27T23:00:00Z",
          end: "2026-09-28T01:30:00Z",
        },
      ],
    };
    const html = render(v);
    expect(html).toMatch(/data-maintenance="" role="status"/);
    expect(text(html)).toContain(
      "Maintenance Postgres upgrade Primary Postgres, Replica Postgres · until 2026-09-28 01:30 UTC",
    );
    expect(until("2026-09-27T23:59:00Z", base.now)).toBe("23:59 UTC");
  });

  it("renders every group in the server markup, the pager hidden until the client pages them", () => {
    const html = render(view("default"));
    expect(html.match(/data-g-group="/g)).toHaveLength(5);
    expect(html).not.toMatch(/data-g-group="[^"]*" hidden/);
    expect(html).toMatch(/<div hidden="" data-pager=""/);
  });

  it("is phone safe: one column below 900 px, the one-screen layout only from 900 px", () => {
    const html = render(view("incident"));
    const root = html.match(/^<div class="([^"]*)"/)![1]!;
    expect(root).toContain("min-h-dvh");
    expect(root).toContain("min-[900px]:h-dvh");
    expect(root).toContain("min-[900px]:overflow-hidden");
    expect(root).not.toMatch(/(^| )(h-dvh|h-screen|overflow-hidden)( |$)/);
    expect(html).toMatch(/class="grid grid-cols-1 [^"]*min-\[900px\]:overflow-hidden/);
    // Tile lists are one column until the wall breakpoint; nothing sets a fixed pixel width.
    expect(html.match(/<ul style="--g-cols:[^"]*" class="grid grid-cols-1 /g)).toHaveLength(5);
    expect(html).not.toMatch(/\b(min-)?w-\[\d+px\]/);
  });
});

/**
 * The stale fixture with three open incidents (the incident fixture's, copied) and a long service name:
 * more alerts than a wall can show next to the tiles.
 */
const LONG_NAME = "API health (edge) behind the regional load balancer";
const crowded = (): SiteView => {
  const v = view("stale");
  const [open] = view("incident").incidents.open;
  const incidents = ["a", "b", "c"].map((n, i) => ({
    ...open!,
    id: `inc-${n}`,
    title: `Incident ${n.toUpperCase()} down`,
    startedAt: `2026-09-27T23:5${i}:00Z`,
  }));
  const [first, ...rest] = v.sections;
  const [svc, ...others] = first!.services;
  return {
    ...v,
    incidents: { ...v.incidents, open: incidents },
    sections: [{ ...first!, services: [{ ...svc!, name: LONG_NAME }, ...others] }, ...rest],
  };
};

describe("theme G under alert pressure (wall screen)", () => {
  it("plans the alert rows: at most two strips, a +M more row, stale folded while incidents are open", () => {
    expect(alertPlan(crowded())).toEqual({ staleInHeader: true, shown: 2, more: 1, rows: 3 });
    expect(alertPlan(view("stale"))).toEqual({ staleInHeader: false, shown: 1, more: 0, rows: 1 });
    expect(alertPlan(view("incident"))).toEqual({ staleInHeader: false, shown: 1, more: 0, rows: 1 });
    expect(alertPlan(view("default"))).toEqual({ staleInHeader: false, shown: 0, more: 0, rows: 0 });
    const twoAndStale = crowded();
    twoAndStale.incidents = { ...twoAndStale.incidents, open: twoAndStale.incidents.open.slice(0, 2) };
    expect(alertPlan(twoAndStale)).toEqual({ staleInHeader: true, shown: 2, more: 0, rows: 2 });
  });

  it("caps the incident strips on the wall, keeps them all for a phone, and counts the rest", () => {
    const html = render(crowded());
    const strip = (id: string) => html.match(new RegExp(`<div data-incident="${id}"[^>]*>`))![0];
    for (const id of ["inc-a", "inc-b"]) {
      expect(strip(id)).not.toContain("data-overflow");
      expect(strip(id)).not.toContain("min-[900px]:hidden");
      // One line on the wall: no wrapping from 900 px.
      expect(strip(id)).toContain("min-[900px]:flex-nowrap");
    }
    expect(strip("inc-c")).toContain('data-overflow=""');
    expect(strip("inc-c")).toMatch(/class="[^"]*min-\[900px\]:hidden/);
    // Every incident is still in the markup (a phone shows them all).
    for (const n of ["A", "B", "C"]) expect(html).toContain(`Incident ${n} down`);
    const more = html.match(/<p data-more="1"[^>]*>(.*?)<\/p>/)!;
    expect(more[0]).toMatch(/class="hidden [^"]*min-\[900px\]:flex/);
    expect(text(more[1]!)).toContain("+1 more Incident C down");
  });

  it("folds the stale strip into the header while incidents are open", () => {
    const html = render(crowded());
    const stale = html.match(/<div data-stale="stale"[^>]*>/)![0];
    expect(stale).toContain('data-folded=""');
    expect(stale).toMatch(/class="[^"]*min-\[900px\]:hidden/);
    const header = html.match(/<div data-stale-folded=""[^>]*>(.*?)<\/div>/)![1]!;
    expect(text(header)).toContain("Stale: last data 14 min ago");
    expect(text(header)).toContain("Not reporting: kuma:watch-1, probe:cf · last snapshot 23:57 UTC");
    // Without open incidents the stale strip keeps its row and the header its one line.
    const alone = render(view("stale"));
    expect(alone.match(/<div data-stale="stale"[^>]*>/)![0]).not.toContain("min-[900px]:hidden");
    expect(alone).not.toContain("data-stale-folded");
  });

  it("folds the recent incidents to one line under pressure, never on a calm board", () => {
    const html = render(crowded());
    const history = html.slice(html.indexOf('<section aria-labelledby="g-history"'));
    expect(history).toMatch(/^<section [^>]*data-g-history="" data-squeezed=""/);
    expect(history).toMatch(/<ol class="grid [^"]*min-\[900px\]:group-data-squeezed\/h:hidden/);
    const line = history.match(/<p data-g-history-line=""[^>]*>(.*?)<\/p>/)!;
    expect(line[0]).toMatch(/class="hidden [^"]*min-\[900px\]:group-data-squeezed\/h:block/);
    expect(line[1]).toMatch(/^(Resolved|Open): .+ · lasted .+ · \+\d more$/);
    for (const name of ["default", "incident", "stale"] as const)
      expect(render(view(name))).not.toContain('data-squeezed=""');
  });

  it("keeps the board at least one row of tiles tall and every tile name on one line", () => {
    const html = render(crowded());
    expect(html).toMatch(
      /<section aria-labelledby="g-services" class="[^"]*min-\[900px\]:min-h-\(--g-board-min\)/,
    );
    const long = html.match(
      new RegExp(`<h3 title="${LONG_NAME.replace(/[()]/g, "\\$&")}" class="([^"]*)">([^<]*)</h3>`),
    )!;
    expect(long[2]).toBe(LONG_NAME);
    expect(long[1]).toContain("min-[900px]:truncate");
    for (const h of html.matchAll(/<h3 title="([^"]*)" class="([^"]*)">([^<]*)<\/h3>/g)) {
      expect(h[2]).toContain("min-[900px]:truncate");
      expect(h[1]).toBe(h[3]);
    }
  });

  it("gives the tile name the full tile width: the state word sits on its own row below it", () => {
    const html = render(view("incident"));
    const heads = [
      ...html.matchAll(
        /<div data-g-head="" class="([^"]*)"><h3 title="[^"]*" class="([^"]*)">[^<]*<\/h3><span[^>]*>/g,
      ),
    ];
    // Every service tile and fact tile has one head; the name is the head's first row, alone on it.
    expect(heads.length).toBe(html.match(/<h3 /g)!.length);
    for (const [, box, name] of heads) {
      expect(box).toContain("flex-col");
      expect(box).not.toContain("justify-between");
      // One line on a wall screen, at a size that fits a typical 24-character name in a 4-column tile.
      expect(name).toContain("min-[900px]:truncate");
      expect(name).toContain("min-[900px]:text-[1.5rem]");
    }
    const down = tile(html, services(view("incident")).find((s) => s.state === "down")!.id);
    expect(down).toMatch(/<\/h3><span[^>]*>.*DOWN<\/span><\/div>/i);
  });
});

describe("theme G helpers", () => {
  it("formats ages, uptimes and groups like the mock-up", () => {
    expect([ago(null), ago(34), ago(360), ago(7200), ago(4 * 86400)]).toEqual([
      "never",
      "34 s",
      "6 min",
      "2 h",
      "4 days",
    ]);
    expect(pct(0.99857)).toBe("99.85%");
    expect(pct(1)).toBe("100.00%");
    expect(pct(null)).toBeNull();
    const groups = boardGroups(view("default"));
    expect(groups.map((g) => g.title)).toEqual(["Web", "Database", "Access", "Workers", "Infrastructure"]);
    // The kuma and watchdog groups are in the footer's highlights, not repeated as tiles.
    const infra = groups.at(-1)!;
    expect(infra.kind === "facts" && infra.groups.map((g) => g.id)).toEqual([
      "forgejo",
      "replication",
      "fence",
      "backup",
      "runners",
      "disk",
    ]);
  });

  it("pages groups in order and starts on the page with the worst group", () => {
    const fitsTwo = (set: number[]) => set.length <= 2;
    expect(paginate(5, fitsTwo)).toEqual([[0, 1], [2, 3], [4]]);
    expect(paginate(3, () => true)).toEqual([[0, 1, 2]]);
    // A group too tall for a page alone still gets a page.
    expect(paginate(2, () => false)).toEqual([[0], [1]]);
    expect(startPage([[0, 1], [2, 3], [4]], [0, 0, 0, 5, 1])).toBe(1);
    expect(startPage([[0], [1]], [0, 0])).toBe(0);
  });
});

describe("theme G rotation (client)", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let wall = true;
  let reduced = false;
  const roots: Root[] = [];

  beforeEach(() => {
    wall = true;
    reduced = false;
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce") ? reduced : wall,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    // The grid is 100 px tall; each shown group takes 40 px, so two fit on a page.
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return [...this.children].filter((c) => !(c as HTMLElement).hidden).length * 40;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  });

  afterEach(() => {
    for (const r of roots.splice(0)) act(() => r.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** The incident fixture with the failing Database section moved to the end of the config. */
  const failingLast = () => {
    const v = view("incident");
    const db = v.sections.find((s) => s.id === "database")!;
    return { ...v, sections: [...v.sections.filter((s) => s !== db), db] };
  };

  const mount = (v: SiteView) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(createElement(Board, { view: v })));
    const shown = () =>
      [...host.querySelectorAll<HTMLElement>("[data-g-group]")]
        .filter((g) => !g.hidden)
        .map((g) => g.dataset.gGroup);
    const label = () => host.querySelector("[data-pager] p")?.textContent ?? "";
    const pager = () => host.querySelector<HTMLElement>("[data-pager]")!;
    return { host, shown, label, pager };
  };

  it("pages the groups that do not fit, starting on the worst, and turns every 10 s", () => {
    const b = mount(failingLast());
    expect(b.pager().hidden).toBe(false);
    expect(b.shown()).toEqual(["workers", "database"]);
    expect(b.label()).toBe("Page 2 of 3: Workers, Database");
    act(() => vi.advanceTimersByTime(10_000));
    expect(b.shown()).toEqual(["_infra"]);
    act(() => vi.advanceTimersByTime(10_000));
    expect(b.shown()).toEqual(["web", "access"]);
    // A manual turn restarts the clock.
    act(() => vi.advanceTimersByTime(6_000));
    act(() => b.host.querySelector<HTMLButtonElement>('[aria-label="Previous page"]')!.click());
    expect(b.shown()).toEqual(["_infra"]);
    act(() => vi.advanceTimersByTime(6_000));
    expect(b.shown()).toEqual(["_infra"]);
    act(() => vi.advanceTimersByTime(4_000));
    expect(b.shown()).toEqual(["web", "access"]);
  });

  it("holds the worst page under reduced motion; the buttons still turn it", () => {
    reduced = true;
    const b = mount(failingLast());
    expect(b.shown()).toEqual(["workers", "database"]);
    act(() => vi.advanceTimersByTime(60_000));
    expect(b.shown()).toEqual(["workers", "database"]);
    expect(
      b.host.querySelector(".motion-safe\\:animate-\\[g-fill_var\\(--g-page-ms\\)_linear_forwards\\]"),
    ).toBeNull();
    act(() => b.host.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click());
    expect(b.shown()).toEqual(["_infra"]);
  });

  const mountPage = (v: SiteView) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    act(() => root.render(createElement(gWallboard.Page, { view: v, commit: "cbe27a13" })));
    return host.querySelector<HTMLElement>("[data-g-history]")!;
  };

  it("folds the recent incidents when the full row would push the board off a short wall screen", () => {
    // main holds the verdict, the board and the history: 3 x 40 px in 100 px overflows.
    expect(mountPage(view("default")).hasAttribute("data-squeezed")).toBe(true);
  });

  it("keeps the recent incidents in full on a phone", () => {
    wall = false;
    expect(mountPage(view("default")).hasAttribute("data-squeezed")).toBe(false);
  });

  it("does not page below 900 px: every group shows and the page scrolls", () => {
    wall = false;
    const b = mount(failingLast());
    expect(b.pager().hidden).toBe(true);
    expect(b.shown()).toHaveLength(5);
    act(() => vi.advanceTimersByTime(30_000));
    expect(b.shown()).toHaveLength(5);
  });
});
