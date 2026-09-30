import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES, themeFor } from "@/client/themes";
import { FONTS, iMinimal, THEME_COLOR, THEME_COLOR_DARK } from "@/client/themes/i-minimal";
import { cellTitle, dur, pct } from "@/client/themes/i-minimal/format";
import { findForbiddenLiterals } from "@/shared/model";
import { buildSiteView, type SiteView } from "@/shared/view";
import { FIXTURE_NAMES, type FixtureName } from "../fixtures";
import { fixtureInput } from "../fixtures/view";

const view = (name: FixtureName) => buildSiteView(fixtureInput(name));
const render = (v: SiteView) =>
  renderToStaticMarkup(createElement(iMinimal.Page, { view: v, commit: "cbe27a13" }));

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
/** The services block (the facts below it age with the facts probe, not the monitors). */
const servicesBlock = (html: string) =>
  html.slice(html.indexOf('aria-labelledby="i-h-svc"'), html.indexOf('aria-labelledby="i-h-sys"'));
const verdict = (html: string) =>
  /<section role="status" aria-label="Overall status">([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";

describe("theme I audit", () => {
  it.each(FIXTURE_NAMES)("renders the %s fixture without address, email or token literals", (name) => {
    expect(findForbiddenLiterals(render(view(name)))).toEqual([]);
  });

  it.each(FIXTURE_NAMES)("renders the %s fixture without em or en dashes", (name) => {
    expect(render(view(name))).not.toMatch(/[–—]/);
  });
});

describe("theme I page", () => {
  it("registers as i-minimal on data-theme i with its base colour", () => {
    expect(iMinimal).toMatchObject({ id: "i-minimal", label: "Minimal", dataTheme: "i" });
    expect(THEMES["i-minimal"]).toEqual({
      module: iMinimal,
      themeColor: THEME_COLOR,
      themeColorDark: THEME_COLOR_DARK,
      fonts: FONTS,
    });
    expect(themeFor("i-minimal").module).toBe(iMinimal);
    expect(THEME_COLOR).toBe("#ffffff");
  });

  it("healthy: one verdict line with the real age, every service with a 90-day strip and past incidents", () => {
    const v = view("default");
    const html = render(v);
    expect(verdict(html)).toContain('data-state="operational"');
    expect(text(verdict(html))).toBe("All systems operational8 services, updated 34s ago");
    for (const s of services(v)) {
      expect(html).toContain(`title="${s.name}"`);
      expect(html).toContain(`data-beats="${s.beatsText}"`);
    }
    expect(html.match(/data-w="/g)).toHaveLength(90 * services(v).length);
    for (const s of v.sections) expect(html).toContain(`aria-label="${s.title}"`);
    expect(html).not.toContain("Ongoing");
    expect(html).not.toContain('role="alert"');
    expect(text(html)).toContain("Sep 15Replica Postgres down 42 min");
    expect(text(html)).toContain("status.example.com");
  });

  it("incident: the down count, the ongoing incident and a bold down state", () => {
    const v = view("incident");
    const html = render(v);
    expect(text(verdict(html))).toBe("1 service down1 down of 8, updated 34s ago");
    expect(html).not.toMatch(/just now/i);
    expect(text(html)).toContain("OngoingReplica Postgres downSince 23:52 UTC, 6 min. Detected");
    expect(html).toMatch(/data-s="down" class="[^"]*font-semibold[^"]*"><i[^>]*><\/i>Down</);
  });

  it("stale: a hollow dot, no count line, a plain stale sentence without brackets, no green state", () => {
    const v = view("stale");
    const html = render(v);
    expect(verdict(html)).toContain("border-2 border-stale bg-transparent");
    expect(text(verdict(html))).toBe("Data is stale");
    const note = /<p role="alert"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(text(note)).toBe(
      "Last data 14 min ago. Monitoring has not reported since Sep 27, 23:57 UTC. Statuses below are the last known and may have changed.",
    );
    expect(text(note)).not.toMatch(/[()]/);
    const block = servicesBlock(html);
    expect(block).not.toContain('data-s="up"');
    expect(block.match(/data-s="stale"/g)?.length).toBe(services(v).length);
  });

  it("maintenance: title, scope and end on one line", () => {
    const v: SiteView = {
      ...view("default"),
      maintenance: [
        {
          id: "db",
          title: "Database upgrade",
          services: ["kuma:3"],
          start: "2026-09-27T23:00:00Z",
          end: "2026-09-28T01:30:00Z",
        },
      ],
    };
    const html = render(v);
    expect(html).toContain("data-maintenance");
    expect(text(html)).toContain("Maintenance: Database upgrade, Primary Postgres, until Sep 28 01:30 UTC.");
  });

  it("says when nothing reported, and hides the stale note while a window covers the site", () => {
    const stale = view("stale");
    expect(render({ ...stale, freshness: { ...stale.freshness, quietForMaintenance: true } })).not.toContain(
      "Last data",
    );
    const empty: SiteView = {
      ...stale,
      verdict: { state: "empty", label: "No data yet", down: 0, degraded: 0 },
      freshness: { ...stale.freshness, state: "empty", ageS: null },
    };
    expect(text(render(empty))).toContain("No data yet. Waiting for monitoring to report.");
  });

  it("shows the profiles' headline, highlights and fact groups in the same quiet rows", () => {
    const v = view("default");
    const t = text(render(v));
    expect(t).toContain(v.headline!);
    expect(t).toContain("2.5.5 · db 41.2 MBlatest");
    for (const g of ["Forgejo", "Replication", "Fence", "Backup", "Runners", "Disk"]) expect(t).toContain(g);
  });

  it("is phone safe: the strip drops under the name at full width, names truncate", () => {
    const html = render(view("incident"));
    for (const m of html.matchAll(/(?:^|[\s"])(?:min-)?w-\[(\d+)px\]/g))
      expect(Number(m[1])).toBeLessThanOrEqual(180);
    expect(html).toContain("max-w-[600px]");
    expect(html).toContain("max-[560px]:col-span-full max-[560px]:row-start-2");
    expect(html).toContain("max-[560px]:w-full");
    expect(html).toContain("min-w-0 truncate");
  });
});

describe("theme I format", () => {
  it("formats durations, percentages and strip titles like the mock-up", () => {
    expect(dur(34)).toBe("34s");
    expect(dur(840)).toBe("14 min");
    expect(dur(7500)).toBe("2h 5m");
    expect(dur(3 * 86400 + 4 * 3600)).toBe("3d 4h");
    expect(pct(0.99996)).toBe("100%");
    expect(pct(0.9708)).toBe("97.08%");
    expect(cellTitle({ day: "2026-09-15", worst: "down", uptime: 0.9708, minutesDown: 42 })).toBe(
      "Sep 15: Down, 97.08%",
    );
    expect(cellTitle({ day: "2026-09-15", worst: null, uptime: null, minutesDown: 0 })).toBe(
      "Sep 15: no data",
    );
  });
});

describe("theme I stale with open incidents", () => {
  it("never paints text in the page-background colour", () => {
    expect(render(staleWithOpen())).not.toMatch(PAGE_COLOUR_TEXT);
  });
});
