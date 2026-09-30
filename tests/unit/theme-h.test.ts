import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES, themeFor } from "@/client/themes";
import { hFriendly, THEME_COLOR } from "@/client/themes/h-friendly";
import { ago, duration, heroText, listNames, pct } from "@/client/themes/h-friendly/format";
import { findForbiddenLiterals } from "@/shared/model";
import { buildSiteView, type SiteView } from "@/shared/view";
import { FIXTURE_NAMES, type FixtureName } from "../fixtures";
import { fixtureInput } from "../fixtures/view";

const view = (name: FixtureName) => buildSiteView(fixtureInput(name));
const render = (v: SiteView) =>
  renderToStaticMarkup(createElement(hFriendly.Page, { view: v, commit: "cbe27a13" }));

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

describe("theme H audit", () => {
  it.each(FIXTURE_NAMES)("renders the %s fixture without address, email or token literals", (name) => {
    expect(findForbiddenLiterals(render(view(name)))).toEqual([]);
  });

  it.each(FIXTURE_NAMES)("renders the %s fixture without em or en dashes", (name) => {
    expect(render(view(name))).not.toMatch(DASHES);
  });
});

describe("theme H page", () => {
  it("registers as h-friendly on data-theme h with its warm base colour", () => {
    expect(hFriendly).toMatchObject({ id: "h-friendly", label: "Friendly", dataTheme: "h" });
    expect(THEMES["h-friendly"]).toEqual({ module: hFriendly, themeColor: THEME_COLOR });
    expect(themeFor("h-friendly").module).toBe(hFriendly);
    expect(THEME_COLOR).toBe("#fff8f1");
  });

  it("greets a healthy site with a happy face and plain words", () => {
    const v = view("default");
    const html = render(v);
    const t = text(html);
    expect(html).toContain('aria-label="A happy face"');
    expect(t).toContain("All systems operational");
    expect(t).toContain("Everything is running smoothly");
    expect(t).toContain("All 8 parts of Acme Cloud are up and answering. Nothing for you to worry about.");
    expect(t).toContain("Last update received just now");
    expect(t).toContain("8 of 8 working");
    for (const s of services(v)) expect(t).toContain(s.name);
    expect(html.match(/data-tone="up"[^>]*>(?:<svg.*?<\/svg>)Working</g)?.length).toBeGreaterThanOrEqual(8);
    // Days bars and the technical details under every service.
    expect(t).toContain("90 smooth days out of 90");
    expect(html.match(/<summary[^>]*>.*?Technical details<\/summary>/g)?.length).toBeGreaterThanOrEqual(8);
    expect(t).toContain("Valid for 73 more days (Example CA)");
    // Calm: no callouts, no open incidents; the past ones listed as fixed.
    expect(html).not.toMatch(/<aside role="status" data-freshness=/);
    expect(t).not.toContain("What’s happening right now");
    expect(t).toContain("Earlier hiccups");
    expect(html.match(/data-incident="resolved"/g)).toHaveLength(v.incidents.recent.length);
    expect(t).toContain(
      "16 September: Replica Postgres wasn't working for 18 minutes, from 02:40 UTC to 02:58 UTC.",
    );
  });

  it("shows a worried face and what is not working during an incident", () => {
    const v = view("incident");
    const html = render(v);
    const t = text(html);
    expect(html).toContain('aria-label="A worried face"');
    expect(t).toContain("One part of Acme Cloud isn't working right now");
    expect(t).toContain("Replica Postgres is having trouble. Everything else is working normally.");
    expect(t).toContain("What’s happening right now");
    expect(html.match(/data-incident="open"/g)).toHaveLength(1);
    expect(t).toContain("Replica Postgres stopped working 6 minutes ago (at 23:52 UTC).");
    expect(html).toMatch(/id="svc-kuma:5"[^>]*data-state="down"/);
    expect(t).toContain("7 of 8 working");
  });

  it("shows a sleepy face and no green light once the data is stale", () => {
    const v = view("stale");
    const html = render(v);
    const t = text(html);
    expect(html).toContain('aria-label="A sleepy face"');
    expect(t).toContain("We haven't had an update in a while");
    expect(t).toContain("Our checks last reached us 14 minutes ago");
    expect(html).toContain('data-freshness="stale"');
    expect(t).toContain("Heads up: this page may be out of date");
    expect(t).toContain("The last update came in 14 minutes ago.");
    expect(services(v).every((s) => s.state === "stale")).toBe(true);
    expect(html.match(/<li id="svc-[^"]+"[^>]*data-state="stale"/g)).toHaveLength(services(v).length);
    expect(html).not.toMatch(/<li id="svc-[^"]+"[^>]*data-state="up"/);
    // The only green pills left are the past incidents' "Fixed".
    expect(
      html.match(/data-tone="up"[^>]*>(?:<svg.*?<\/svg>)[^<]*</g)?.map((m) => m.replace(/.*>/, "")),
    ).toEqual(v.incidents.recent.map(() => "Fixed<"));
    expect(t).toContain("No recent update");
    expect(html).not.toMatch(/data-level="ok" class="text-up/);
  });

  it("explains a maintenance window in plain words", () => {
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
    expect(t).toContain("Planned work: Database upgrade");
    expect(t).toContain(
      "From 27 September at 23:00 UTC until 28 September at 01:30 UTC. This affects Primary Postgres, Replica Postgres, so a short pause there is expected.",
    );
  });

  it("keeps the markup phone safe: clipped page, one column, stacked hero", () => {
    const html = render(view("incident"));
    expect(html).toMatch(/^<div class="[^"]*overflow-x-clip/);
    expect(html).toContain("max-w-[62rem]");
    expect(html).toContain("max-[760px]:grid-cols-1");
    expect(html).toContain("max-[560px]:grid-cols-1");
    expect(html).toContain("[overflow-wrap:anywhere]");
    for (const m of html.matchAll(/\bw-\[(\d+)px\]/g)) expect(Number(m[1])).toBeLessThanOrEqual(320);
  });

  it("puts the words together", () => {
    expect(ago(null)).toBe("not yet");
    expect(ago(34)).toBe("just now");
    expect(ago(840)).toBe("14 minutes ago");
    expect(duration(30)).toBe("less than a minute");
    expect(duration(4320)).toBe("1 hour and 12 minutes");
    expect(pct(null)).toBe("not measured yet");
    expect(listNames(["A", "B", "C"])).toBe("A, B and C");
    const v = view("default");
    const degraded: SiteView = {
      ...v,
      verdict: { state: "degraded", label: "1 service degraded", down: 0, degraded: 1 },
      sections: v.sections.map((s, i) =>
        i === 0
          ? { ...s, services: s.services.map((x, j) => (j === 0 ? { ...x, state: "degraded" } : x)) }
          : s,
      ),
    };
    expect(heroText(degraded, "Acme Cloud", 34)).toEqual({
      h: "Some things are a little slow right now",
      p: "API health is working, but slower than usual. Everything else is fine.",
    });
  });
});

describe("theme H stale with open incidents", () => {
  it("never paints text in the page-background colour", () => {
    expect(render(staleWithOpen())).not.toMatch(PAGE_COLOUR_TEXT);
  });
});
