import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES, themeFor } from "@/client/themes";
import { dClassic, THEME_COLOR } from "@/client/themes/d-classic";
import { fmtDur, fmtPct, tickTitle, worstState } from "@/client/themes/d-classic/format";
import { findForbiddenLiterals } from "@/shared/model";
import { buildSiteView, type SiteView } from "@/shared/view";
import { FIXTURE_NAMES, type FixtureName } from "../fixtures";
import { fixtureInput } from "../fixtures/view";

const view = (name: FixtureName) => buildSiteView(fixtureInput(name));
const render = (v: SiteView) =>
  renderToStaticMarkup(createElement(dClassic.Page, { view: v, commit: "cbe27a13" }));

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
const services = (v: SiteView) => v.sections.flatMap((s) => s.services);
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
const banner = (html: string) => /<section role="status"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
/** The services block (the facts below it age with the facts probe, not the monitors). */
const servicesBlock = (html: string) =>
  html.slice(html.indexOf('aria-labelledby="d-h-svc"'), html.indexOf('aria-labelledby="d-h-sys"'));

describe("theme D audit", () => {
  it.each(FIXTURE_NAMES)("renders the %s fixture without address, email or token literals", (name) => {
    expect(findForbiddenLiterals(render(view(name)))).toEqual([]);
  });

  it.each(FIXTURE_NAMES)("renders the %s fixture without em or en dashes", (name) => {
    expect(render(view(name))).not.toMatch(/[–—]/);
  });
});

describe("theme D page", () => {
  it("registers as d-classic on data-theme d with its base colour", () => {
    expect(dClassic).toMatchObject({ id: "d-classic", label: "Classic", dataTheme: "d" });
    expect(THEMES["d-classic"]).toEqual({ module: dClassic, themeColor: THEME_COLOR });
    expect(themeFor("d-classic").module).toBe(dClassic);
    expect(THEME_COLOR).toBe("#f6f7f9");
  });

  it("healthy: green band, every group and service with a 90-day bar, the legend and past incidents", () => {
    const v = view("default");
    const html = render(v);
    expect(banner(html)).toContain('data-state="operational"');
    expect(text(banner(html))).toContain("All systems operational");
    expect(text(banner(html))).toContain("8 of 8 services operational. Updated 34 sec ago.");
    for (const s of v.sections) expect(html).toContain(`id="d-g-${s.id}"`);
    for (const s of services(v)) {
      expect(html).toContain(s.name);
      expect(html).toContain(`data-beats="${s.beatsText}"`);
    }
    expect(html.match(/data-w="/g)).toHaveLength(90 * services(v).length);
    expect(html).toContain('aria-label="History legend"');
    expect(html).not.toContain("Active incidents");
    expect(html).not.toContain("data-maintenance");
    expect(html).not.toContain('role="alert"');
    expect(text(html)).toContain("Started 03:10 UTC. Resolved at 03:52 UTC after 42 min.");
    expect(text(html)).toContain("status.example.com");
    expect(text(html)).toContain("Powered by Uptellis");
  });

  it("incident: red band with the real data age (never 'just now'), the open incident and its steps", () => {
    const v = view("incident");
    const html = render(v);
    const line = text(banner(html));
    expect(banner(html)).toContain('data-state="outage"');
    expect(line).toContain("1 service down");
    expect(line).toContain("1 service is down. Updated 34 sec ago.");
    expect(html).not.toMatch(/just now/i);
    const open = v.incidents.open[0]!;
    expect(text(html)).toContain("Active incidents1 ongoing");
    expect(text(html)).toContain(`${open.title}Ongoing for 6 min`);
    expect(text(html)).toContain(`Affected service: ${open.subject}`);
    expect(text(html)).toContain("DetectedSep 27, 23:52 UTC");
    expect(html).toMatch(/data-s="down"[^>]*>(?:(?!<\/span>).)*Down<\/span>/);
  });

  it("stale: grey band, the out-of-date notice with the last report, every service 'No recent data'", () => {
    const v = view("stale");
    const html = render(v);
    expect(banner(html)).toContain('data-state="stale"');
    expect(text(banner(html))).toContain("Last update received 14 min ago.");
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(
      "We have not received fresh monitoring data for 14 min (last data at Sep 27, 23:57 UTC).",
    );
    // Stale data never keeps a green state word: the section heads and rows all read "No recent data".
    const block = servicesBlock(html);
    expect(block).not.toContain('data-s="up"');
    expect(block.match(/data-s="stale"/g)?.length).toBe(v.sections.length + services(v).length);
    // Latency is hidden once stale.
    expect(html).not.toContain("Latest response time");
  });

  it("maintenance: the window's span and the services it covers", () => {
    const v: SiteView = {
      ...view("default"),
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
    expect(t).toContain("Scheduled maintenance: Database upgrade");
    expect(t).toContain(
      "Sep 27, 23:00 UTC to Sep 28, 01:30 UTC. Affects Primary Postgres, Replica Postgres.",
    );
  });

  it("hides the stale notice while a window covers the whole site, and says when nothing reported", () => {
    const stale = view("stale");
    expect(render({ ...stale, freshness: { ...stale.freshness, quietForMaintenance: true } })).not.toContain(
      "Status data is out of date",
    );
    const empty: SiteView = {
      ...stale,
      verdict: { state: "empty", label: "No data yet", down: 0, degraded: 0 },
      freshness: { ...stale.freshness, state: "empty", ageS: null },
    };
    const t = text(render(empty));
    expect(t).toContain("No monitoring data has been received yet.");
    expect(t).toContain("Waiting for monitoring data");
  });

  it("shows the profiles' headline, highlights and fact groups", () => {
    const v = view("default");
    const t = text(render(v));
    expect(t).toContain("System details");
    expect(t).toContain(v.headline!);
    expect(t).toContain("2.5.5 · db 41.2 MB");
    expect(t).toContain("latest");
    for (const g of ["Forgejo", "Replication", "Fence", "Backup", "Runners", "Disk"]) expect(t).toContain(g);
  });

  it("is phone safe: fluid bars, no fixed width past a 390 px screen, wrapping names", () => {
    const html = render(view("incident"));
    for (const m of html.matchAll(/(?:^|[\s"])(?:min-)?w-\[(\d+)px\]/g))
      expect(Number(m[1])).toBeLessThanOrEqual(358);
    expect(html).toContain("max-w-[880px]");
    expect(html).toContain("max-[600px]:gap-px");
    expect(html).toContain("min-w-0 flex-[1_1_0]");
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain("max-[600px]:grid-cols-1");
  });
});

describe("theme D format", () => {
  it("formats durations, percentages and tick titles like the mock-up", () => {
    expect(fmtDur(34)).toBe("34 sec");
    expect(fmtDur(840)).toBe("14 min");
    expect(fmtDur(7500)).toBe("2 h 5 min");
    expect(fmtDur(3 * 86400 + 4 * 3600)).toBe("3 d 4 h");
    expect(fmtPct(0.99996)).toBe("100%");
    expect(fmtPct(0.99951)).toBe("99.95%");
    expect(fmtPct(null)).toBeNull();
    expect(tickTitle({ day: "2026-09-15", worst: "down", uptime: 0.9708, minutesDown: 42 })).toBe(
      "Sep 15, 2026, Down, 97.08% uptime, 42 min down",
    );
    expect(tickTitle({ day: "2026-09-15", worst: null, uptime: null, minutesDown: 0 })).toBe(
      "Sep 15, 2026, No data",
    );
  });

  it("picks the worst state for the other services group", () => {
    const [a, b] = services(view("incident")).filter((s) => s.id === "kuma:3" || s.id === "kuma:5");
    expect(worstState([a!, b!])).toBe("down");
    expect(worstState([])).toBe("unknown");
  });
});

describe("theme D stale with open incidents", () => {
  it("keeps the incident titles in the dark down colour, never the page-background colour", () => {
    const v = staleWithOpen();
    expect(v.freshness.state).toBe("stale");
    const html = render(v);
    expect(html).not.toMatch(PAGE_COLOUR_TEXT);
    for (const title of ["Source facts:app-1 stale", "API health (edge) down"]) {
      const h3 = new RegExp(`<h3 class="([^"]*)">${title.replace(/[()]/g, "\\$&")}</h3>`).exec(html);
      expect(h3?.[1]).toContain("text-(--d-down-text)");
    }
  });
});
