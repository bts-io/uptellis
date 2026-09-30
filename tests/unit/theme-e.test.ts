import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES, themeFor } from "@/client/themes";
import { eEditorial, THEME_COLOR } from "@/client/themes/e-editorial";
import { duration, pct, standfirst } from "@/client/themes/e-editorial/format";
import { findForbiddenLiterals } from "@/shared/model";
import { buildSiteView, type SiteView } from "@/shared/view";
import { FIXTURE_NAMES, type FixtureName } from "../fixtures";
import { fixtureInput } from "../fixtures/view";

const view = (name: FixtureName) => buildSiteView(fixtureInput(name));
const render = (v: SiteView) =>
  renderToStaticMarkup(createElement(eEditorial.Page, { view: v, commit: "cbe27a13" }));

/**
 * The live demo's state: every source silent, one stale-source and one down incident open, and a stale
 * service last seen in maintenance (the longest "last seen" note).
 */
const staleWithOpen = () => {
  const input = fixtureInput("stale");
  const startedAt = "2026-09-27T23:50:00Z";
  input.model.services = input.model.services.map((s, n) => (n === 0 ? { ...s, status: "maintenance" } : s));
  input.model.openIncidents = [
    {
      id: "stale:facts:app-1",
      site: "demo",
      kind: "stale",
      serviceId: null,
      sourceId: "facts:app-1",
      startedAt,
      endedAt: null,
      title: "Source facts:app-1 stale",
      notes: null,
    },
    {
      id: "kuma:5:open",
      site: "demo",
      kind: "down",
      serviceId: "kuma:5",
      sourceId: null,
      startedAt,
      endedAt: null,
      title: "API health (edge) down",
      notes: null,
    },
  ];
  return buildSiteView(input);
};
// `text-base` is a colour here (the page background, from --color-base), not Tailwind's 16px size.
const PAGE_COLOUR_TEXT = /class="[^"]*(?<![\w-])text-base(?![\w-])[^"]*"/;
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
/** En and em dashes, spelled as escapes so the source itself carries none. */
const DASHES = /[\u2013\u2014]/;
const services = (v: SiteView) => v.sections.flatMap((s) => s.services);

describe("theme E audit", () => {
  it.each(FIXTURE_NAMES)("renders the %s fixture without address, email or token literals", (name) => {
    expect(findForbiddenLiterals(render(view(name)))).toEqual([]);
  });

  it.each(FIXTURE_NAMES)("renders the %s fixture without em or en dashes", (name) => {
    expect(render(view(name))).not.toMatch(DASHES);
  });
});

describe("theme E page", () => {
  it("registers as e-editorial on data-theme e with its paper colour", () => {
    expect(eEditorial).toMatchObject({ id: "e-editorial", label: "Editorial", dataTheme: "e" });
    expect(THEMES["e-editorial"]).toEqual({ module: eEditorial, themeColor: THEME_COLOR });
    expect(themeFor("e-editorial").module).toBe(eEditorial);
    expect(THEME_COLOR).toBe("#fbf8f3");
  });

  it("leads a healthy report with the verdict, a standfirst and the dateline", () => {
    const v = view("default");
    const html = render(v);
    const t = text(html);
    expect(t).toContain("Operating normally");
    expect(html).toMatch(/<h1[^>]*>All systems operational\.<\/h1>/);
    expect(t).toContain(
      "All 8 services across 4 sections answered their latest checks in 199 ms on average, with 99.96% uptime over the past 30 days.",
    );
    expect(t).toContain("27 September 2026, 23:57 UTC");
    expect(t).toContain("Updated 34 seconds ago");
    expect(t).toContain("8 services watched");
    expect(t).toContain(`${v.headline}.`);
    expect(t).toContain("8 of 8 operational");
    for (const s of services(v)) expect(t).toContain(s.name);
    // No notices, no developing story, the past incidents in the log.
    expect(html).not.toMatch(/<aside role="status" data-freshness=/);
    expect(t).not.toContain("Developing");
    expect(html.match(/data-incident="resolved"/g)).toHaveLength(v.incidents.recent.length);
    expect(t).toContain(
      "Replica Postgres went down at 02:40 UTC and was back at 02:58 UTC, after 18 minutes.",
    );
  });

  it("reports an incident as a developing story with the failing service named", () => {
    const v = view("incident");
    const html = render(v);
    const t = text(html);
    expect(t).toContain("Service disruption");
    expect(html).toMatch(/<h1[^>]*>1 service down\.<\/h1>/);
    expect(t).toContain(
      "Replica Postgres is down, for 6 minutes so far. The other 7 services are answering normally.",
    );
    expect(t).toContain("Developing1 open incident");
    expect(html.match(/data-incident="open"/g)).toHaveLength(1);
    expect(t).toContain(
      "Replica Postgres stopped answering at 23:52 UTC and has been out for 6 minutes. It is still open.",
    );
    expect(html).toMatch(/id="svc-kuma:5"[^>]*data-state="down"/);
    expect(t).toContain("7 of 8 operational");
  });

  it("says the report is out of date and keeps no service operational once stale", () => {
    const v = view("stale");
    const html = render(v);
    const t = text(html);
    expect(t).toContain("Report out of date");
    expect(t).toContain("Our monitors last reported 14 minutes ago.");
    expect(html).toContain('data-freshness="stale"');
    expect(t).toContain("This report is out of date");
    expect(t).toContain("The stalest source (kuma:watch-1) last reported 14 minutes ago.");
    expect(services(v).every((s) => s.state === "stale")).toBe(true);
    // Every service row says Stale, with what it last showed; none reads Operational in green.
    expect(html.match(/<li id="svc-[^"]+"[^>]*data-state="stale"/g)).toHaveLength(services(v).length);
    expect(t).toContain("(last seen operational)");
    expect(html).not.toMatch(/<li id="svc-[^"]+"[^>]*data-state="up"/);
    // Figures and fact colours drop their level colour on stale data.
    expect(html).not.toMatch(/data-level="ok" class="text-up/);
  });

  it("names a maintenance window with its start, end and what it covers", () => {
    const base = view("default");
    const v: SiteView = {
      ...base,
      maintenance: [
        {
          id: "db",
          title: "Database upgrade",
          services: ["kuma:3", "kuma:5"],
          start: "2026-09-27T23:00:00Z",
          end: "2026-09-28T01:30:00Z",
        },
      ],
    };
    const t = text(render(v));
    expect(t).toContain("Planned maintenance");
    expect(t).toContain(
      "Database upgrade. From 27 Sep, 23:00 UTC to 28 Sep, 01:30 UTC, covering Primary Postgres, Replica Postgres.",
    );
  });

  it("keeps the markup phone safe: clipped page, shrinkable columns, wrapping targets", () => {
    const html = render(view("incident"));
    expect(html).toMatch(/^<div class="[^"]*overflow-x-clip/);
    expect(html).toContain("max-w-[44rem]");
    // Service rows collapse to name and state on a phone; every grid column can shrink.
    expect(html).toContain("grid-cols-[minmax(0,1fr)_13.5rem_4.2rem_7.8rem]");
    expect(html).toContain("max-[640px]:grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain("[overflow-wrap:anywhere]");
    // No fixed pixel widths wider than a phone.
    for (const m of html.matchAll(/\bw-\[(\d+)px\]/g)) expect(Number(m[1])).toBeLessThanOrEqual(320);
  });

  it("formats the article's figures", () => {
    expect(duration(360)).toBe("6 minutes");
    expect(duration(4320)).toBe("1 hour 12 minutes");
    expect(duration(183600)).toBe("2 days 3 hours");
    expect(pct(null)).toBe("n/a");
    expect(pct(1)).toBe("100%");
    expect(pct(0.99996)).toBe("99.99%");
    expect(pct(0.99857)).toBe("99.86%");
    const empty: SiteView = {
      ...view("default"),
      verdict: { state: "empty", label: "No data yet", down: 0, degraded: 0 },
    };
    expect(standfirst(empty, null)).toBe(
      "No monitor has reported yet, so there is nothing to say about the 8 services on this page.",
    );
  });
});

describe("theme E stale with open incidents", () => {
  it("wraps the stale note inside the state column so it never runs over the uptime figure", () => {
    const html = render(staleWithOpen());
    expect(html).not.toMatch(PAGE_COLOUR_TEXT);
    const rows = html.match(/<li id="svc-[^"]+"[^>]*data-state="stale"[\s\S]*?<\/li>/g) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.join("")).toContain("(last seen maintenance)");
    for (const row of rows) {
      const tag = /<span data-state="stale" class="([^"]*)"/.exec(row)?.[1] ?? "";
      expect(tag).toContain("flex-wrap");
      const note = /<small data-note="" class="([^"]*)"/.exec(row)?.[1] ?? "";
      expect(note).toContain("basis-full");
      expect(note).toContain("whitespace-normal");
    }
  });
});
