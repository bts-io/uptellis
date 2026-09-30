import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES, themeFor } from "@/client/themes";
import { fDashboard, THEME_COLOR } from "@/client/themes/f-dashboard";
import { dur, historyStats, pct, siteDays, sparkPaths, when } from "@/client/themes/f-dashboard/format";
import { ServiceCard } from "@/client/themes/f-dashboard/ServiceCard";
import { findForbiddenLiterals } from "@/shared/model";
import { buildSiteView, type SiteView } from "@/shared/view";
import { FIXTURE_NAMES, type FixtureName } from "../fixtures";
import { fixtureInput } from "../fixtures/view";

const view = (name: FixtureName) => buildSiteView(fixtureInput(name));
const render = (v: SiteView) =>
  renderToStaticMarkup(createElement(fDashboard.Page, { view: v, commit: "cbe27a13" }));

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

describe("theme F audit", () => {
  it.each(FIXTURE_NAMES)("renders the %s fixture without address, email or token literals", (name) => {
    expect(findForbiddenLiterals(render(view(name)))).toEqual([]);
  });

  it.each(FIXTURE_NAMES)("renders the %s fixture without em or en dashes", (name) => {
    const html = render(view(name));
    for (const code of [0x2013, 0x2014]) expect(html).not.toContain(String.fromCharCode(code));
  });
});

describe("theme F page", () => {
  it("registers as f-dashboard on data-theme f with its base colour", () => {
    expect(fDashboard).toMatchObject({ id: "f-dashboard", label: "Dashboard", dataTheme: "f" });
    expect(THEMES["f-dashboard"]).toEqual({ module: fDashboard, themeColor: THEME_COLOR });
    expect(themeFor("f-dashboard").module).toBe(fDashboard);
    expect(THEME_COLOR).toBe("#f3f5f9");
  });

  it("renders the healthy page: verdict donut, KPIs, history, every service, facts and infra", () => {
    const v = view("default");
    const html = render(v);
    const t = text(html);
    expect(html).toMatch(/data-state="operational"/);
    expect(t).toContain("All systems operational");
    expect(t).toContain("8/8services up");
    expect(html).toContain('aria-label="8 services: 8 operational"');
    for (const k of ["Avg latency", "Uptime 24h", "Uptime 30d", "Health score", "90-day uptime"])
      expect(t).toContain(k);
    expect(t).toContain("199ms");
    expect(t).toContain("99.2/100");
    expect(t).toContain(v.headline!);
    for (const s of services(v)) expect(t).toContain(s.name);
    for (const s of v.sections) expect(t).toContain(`${s.title} Operational`);
    expect(t).toContain("2 of 2 operational");
    // The highlights in the facts card, the rest of the groups as infra cards.
    expect(t).toContain("System facts");
    expect(t).toContain("db 41.2 MB");
    for (const g of ["Forgejo", "Replication", "Fence", "Backup", "Runners", "Disk"]) expect(t).toContain(g);
    expect(html).not.toContain('data-group="kuma"');
    expect(t).toContain("16.0.5 · HTTP 200 · serving app-1");
    expect(t).toContain("Updated 34 s ago");
    expect(t).toContain("Snapshot 27 Sep, 23:57 UTC · build cbe27a1");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Active incident");
    expect(html).not.toContain("data-maintenance");
  });

  it("draws the charts from the data: a spark per service, 90 ticks per service and 90 history columns", () => {
    const v = view("default");
    const html = render(v);
    expect(html.match(/aria-label="Latency trend over the last/g)).toHaveLength(services(v).length);
    expect(html.match(/aria-label="90-day history,/g)).toHaveLength(services(v).length);
    expect(html).toContain('aria-label="Daily mean uptime over 90 days, 2 days with downtime');
    expect(html.match(/<rect[^>]*data-worst=/g)).toHaveLength(90);
    expect(html).not.toMatch(/<canvas|<script/);
  });

  it("shows the incident: the open incident card with its duration, the down card and the outage verdict", () => {
    const v = view("incident");
    const html = render(v);
    const t = text(html);
    const open = v.incidents.open[0]!;
    expect(html).toMatch(/data-state="outage"/);
    expect(t).toContain("1 service down");
    expect(t).toContain("Active incident");
    expect(t).toContain(open.title);
    expect(t).toContain(`${open.subject} · started 27 Sep, 23:52 UTC`);
    expect(t).toContain("6 minongoing");
    expect(t).toContain("Detected 27 Sep, 23:52 UTC");
    expect(t).toContain("No response to recent checks");
    expect(t).toContain("Database Down");
    expect(t).toContain("1 of 2 operational");
    expect(html).toMatch(/id="svc-kuma:5" tabindex="-1" data-state="down"/);
    expect(t).toContain("down now; uptime 30d 99.85%");
    expect(t).toContain("7/8services up");
  });

  it("marks stale data: the alert with the real age, no green on the services, the donut not current", () => {
    const v = view("stale");
    const html = render(v);
    const t = text(html);
    expect(html).toContain('role="alert" data-state="stale"');
    expect(t).toContain("This data is out of date");
    expect(t).toContain("The newest report from kuma:watch-1 is 14 min old (expected every 1 min)");
    expect(t).toContain("Updated 14 min ago");
    expect(t).toContain("8/8not current");
    expect(t).toContain("Stale data");
    const cards = services(v)
      .map((s) => renderToStaticMarkup(createElement(ServiceCard, { service: s })))
      .join("");
    expect(cards).not.toContain('data-tone="up"');
    expect(cards.match(/data-tone="stale"/g)).toHaveLength(services(v).length);
    const fresh = services(view("default"))
      .map((s) => renderToStaticMarkup(createElement(ServiceCard, { service: s })))
      .join("");
    expect(fresh.match(/data-tone="up"/g)).toHaveLength(services(v).length);
  });

  it("names the services a maintenance window covers, and hides the stale alert while it covers the site", () => {
    const base = view("default");
    const partial = render({
      ...base,
      maintenance: [
        {
          id: "db",
          title: "Postgres upgrade",
          services: ["kuma:3", "kuma:5"],
          start: base.now,
          end: base.now,
        },
      ],
    });
    expect(text(partial)).toContain(
      "Maintenance: Postgres upgrade27 Sep, 23:58 UTC to 27 Sep, 23:58 UTC. Affects: Primary Postgres, Replica Postgres.",
    );
    const stale = view("stale");
    const quiet = render({
      ...stale,
      freshness: { ...stale.freshness, quietForMaintenance: true },
      maintenance: [{ id: "all", title: "Move", services: [], start: stale.now, end: stale.now }],
    });
    expect(quiet).not.toContain('role="alert"');
    expect(text(quiet)).toContain("Affects: All services.");
  });

  it("survives a site without services, facts or sources", () => {
    const v = view("default");
    const empty: SiteView = {
      ...v,
      verdict: { state: "empty", label: "No data yet", down: 0, degraded: 0 },
      freshness: { state: "empty", ageS: null, stalestSourceId: null, perSource: [] },
      summary: {
        total: 0,
        up: 0,
        down: 0,
        degraded: 0,
        maintenance: 0,
        other: 0,
        avgLatencyMs: null,
        uptime24h: null,
        uptime30d: null,
        healthScore: null,
      },
      sections: [],
      unsectioned: [],
      factGroups: [],
      factIndex: {},
      highlights: [],
      headline: null,
      topology: null,
      activity: [],
      incidents: { open: [], recent: [] },
      links: [],
    };
    const t = text(render(empty));
    expect(t).toContain("No services yet");
    expect(t).toContain("No data has been received");
    expect(t).toContain("No data received yet");
    expect(t).toContain("0services");
    expect(t).toContain("No incidents in the recent history.");
    expect(t).not.toContain("90-day uptime");
    expect(t).not.toContain("Infrastructure");
  });

  it("keeps phone-safe markup: one column by default, wrapping text, no wide fixed tracks below a breakpoint", () => {
    const html = render(view("incident"));
    const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/));
    for (const c of classes.filter(
      (x) => /^(grid-cols|w|min-w|basis)-\[/.test(x) && !x.startsWith("min-["),
    )) {
      const px = [...c.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
      // A wide track only inside min(): it shrinks to the phone's width.
      if (!c.includes("min(")) for (const n of px) expect(n, c).toBeLessThanOrEqual(160);
    }
    expect(html).toContain("grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]");
    expect(html).toContain("min-[1181px]:grid-cols-[minmax(0,1fr)_360px]");
    expect(html).not.toMatch(/whitespace-nowrap[^"]*"[^>]*>[^<]{40,}</);
    expect(html).toContain("[overflow-wrap:anywhere]");
  });
});

describe("theme F format", () => {
  it("formats figures the way the mock-up does", () => {
    expect(pct(1)).toBe("100%");
    expect(pct(0.999575)).toBe("99.96%");
    expect(pct(null)).toBe("n/a");
    expect(dur(360)).toBe("6 min");
    expect(dur(7500)).toBe("2 h 5 min");
    expect(dur(3 * 86400 + 4 * 3600)).toBe("3 d 4 h");
    expect(when("2026-09-28T01:30:00Z")).toBe("28 Sep, 01:30 UTC");
  });

  it("sums the site's days and scales the chart just under the worst day", () => {
    const days = siteDays(services(view("default")));
    expect(days).toHaveLength(90);
    expect(days.filter((d) => d.worst === "down").map((d) => d.day)).toEqual(["2026-09-15", "2026-09-16"]);
    const h = historyStats(days);
    expect(h.downDays).toBe(2);
    expect(h.floor).toBeLessThanOrEqual(0.995);
    expect(h.minutesDown).toBeGreaterThan(0);
  });

  it("draws a sparkline only from two points, the same path for the same input", () => {
    expect(sparkPaths([5], 200, 44)).toBeNull();
    const a = sparkPaths([10, 20, 15], 200, 44)!;
    expect(a).toEqual(sparkPaths([10, 20, 15], 200, 44));
    expect(a.line).toBe("M0.0 40.0 L100.0 4.0 L200.0 22.0");
    expect(a.area.endsWith("L200 44 L0 44 Z")).toBe(true);
  });
});

describe("theme F stale with open incidents", () => {
  it("keeps the stale heading and the incident titles readable: no page-background text colour", () => {
    const v = staleWithOpen();
    const html = render(v);
    expect(html).not.toMatch(PAGE_COLOUR_TEXT);
    expect(/<h2 id="f-stale-h" class="([^"]*)">/.exec(html)?.[1]).toContain("text-(--f-degraded-text)");
    for (const title of ["Source facts:app-1 stale", "API health (edge) down"])
      expect(html).toMatch(new RegExp(`<h3 class="[^"]*">${title.replace(/[()]/g, "\\$&")}</h3>`));
  });
});
