import { describe, expect, it } from "vitest";
import { PUBLIC_FIELDS, type PublicField } from "@/shared/config";
import { PublicSummary } from "@/shared/public/summary";
import { buildSiteView, type DisplayState, type SiteView } from "@/shared/view";
import {
  buildPublicSummary,
  isPublished,
  publicState,
  RESOLVED_INCIDENTS,
  summaryService,
  uptime90dOf,
  verdictPublicState,
} from "@/worker/public/summary";
import { fixtureConfig, fixtureInput } from "../fixtures/view";

const view = (name: "default" | "incident" | "stale"): SiteView => buildSiteView(fixtureInput(name));
const keys = (o: object) => Object.keys(o).sort();

describe("public summary: each field unlocks only its part", () => {
  const v = view("incident");

  it("shares only the version and the site with no field", () => {
    const s = buildPublicSummary(v, []);
    expect(s).toEqual({ v: 1, site: { slug: "demo", name: v.site.name } });
    expect(PublicSummary.parse(s)).toEqual(s);
  });

  const unlocks: Record<PublicField, string[]> = {
    verdict: ["verdict"],
    sections: ["sections"],
    // Names and uptime belong to services: without `sections` there is nothing to put them on.
    serviceNames: [],
    uptime90d: [],
    incidentTitles: ["incidents"],
    generatedAt: ["generatedAt"],
  };

  for (const field of PUBLIC_FIELDS) {
    it(`adds only ${unlocks[field].join(", ") || "nothing"} for ${field}`, () => {
      const s = buildPublicSummary(v, [field]);
      expect(keys(s)).toEqual(["site", "v", ...unlocks[field]].sort());
      // Absent, never null or undefined-valued.
      for (const value of Object.values(s)) expect(value).not.toBeNull();
      expect(PublicSummary.parse(s)).toEqual(s);
    });
  }

  it("gives each part exactly its shape", () => {
    const s = buildPublicSummary(v, ["verdict", "generatedAt"]);
    expect(s.verdict).toEqual({ state: "outage", label: "1 service down" });
    expect(s.generatedAt).toBe(v.generatedAt);
  });

  it("lists sections with service ids and states only, until names and uptime are allowed", () => {
    const bare = buildPublicSummary(v, ["sections"]);
    expect(bare.sections!.map((x) => x.id)).toEqual(v.sections.map((x) => x.id));
    for (const section of bare.sections!) {
      expect(keys(section)).toEqual(["id", "services", "title"]);
      for (const svc of section.services) expect(keys(svc)).toEqual(["id", "state"]);
    }

    const named = buildPublicSummary(v, ["sections", "serviceNames"]);
    const all = named.sections!.flatMap((x) => x.services);
    for (const svc of all) expect(keys(svc)).toEqual(["id", "name", "state"]);
    expect(all.find((x) => x.id === "kuma:1")?.name).toBe("API health");

    const uptime = buildPublicSummary(v, ["sections", "uptime90d"]);
    for (const svc of uptime.sections!.flatMap((x) => x.services)) {
      expect(keys(svc)).toEqual(["id", "state", "uptime90d"]);
      const u = svc.uptime90d;
      expect(u === null || (typeof u === "number" && u >= 0 && u <= 1)).toBe(true);
    }
    expect(PublicSummary.parse(uptime)).toEqual(uptime);
  });

  it("never carries view internals (targets, facts, topology, hostnames, activity)", () => {
    const text = JSON.stringify(buildPublicSummary(v, [...PUBLIC_FIELDS]));
    for (const hidden of ["targetDisplay", "hostnames", "factGroups", "topology", "activity", "beats90d"]) {
      expect(text).not.toContain(hidden);
    }
    for (const host of fixtureConfig.hostnames) expect(text).not.toContain(host);
  });

  it("lists open incidents and the last resolved ones, titles and times only", () => {
    const s = buildPublicSummary(v, ["incidentTitles"]);
    expect(s.incidents).toHaveLength(v.incidents.open.length + v.incidents.recent.length);
    expect(s.incidents![0]).toEqual({
      title: v.incidents.open[0]!.title,
      startedAt: v.incidents.open[0]!.startedAt,
      endedAt: null,
    });
    for (const i of s.incidents!) expect(keys(i)).toEqual(["endedAt", "startedAt", "title"]);

    const many: SiteView = {
      ...v,
      incidents: {
        open: v.incidents.open,
        recent: Array.from({ length: 9 }, (_, n) => ({
          ...v.incidents.recent[0]!,
          id: `r${n}`,
          title: `R${n}`,
        })),
      },
    };
    const capped = buildPublicSummary(many, ["incidentTitles"]).incidents!;
    expect(capped).toHaveLength(v.incidents.open.length + RESOLVED_INCIDENTS);
    expect(capped.slice(v.incidents.open.length).map((i) => i.title)).toEqual(["R0", "R1", "R2", "R3", "R4"]);
  });

  it("validates against the contract for every fixture with every field", () => {
    for (const name of ["default", "incident", "stale"] as const) {
      const s = buildPublicSummary(view(name), [...PUBLIC_FIELDS]);
      expect(PublicSummary.parse(s), name).toEqual(s);
    }
  });

  it("finds a service only through shared sections", () => {
    expect(summaryService(buildPublicSummary(v, ["verdict"]), "kuma:1")).toBeNull();
    expect(summaryService(buildPublicSummary(v, ["sections"]), "kuma:1")).toEqual({
      id: "kuma:1",
      state: "up",
    });
    expect(summaryService(buildPublicSummary(v, ["sections"]), "kuma:999")).toBeNull();
  });
});

describe("public states", () => {
  it("maps every display state", () => {
    const expected: Record<DisplayState, string> = {
      up: "up",
      degraded: "degraded",
      pending: "degraded",
      down: "down",
      maintenance: "maintenance",
      stale: "stale",
      paused: "unknown",
      unknown: "unknown",
    };
    for (const [state, out] of Object.entries(expected)) expect(publicState(state as DisplayState)).toBe(out);
  });

  it("maps every verdict", () => {
    expect(verdictPublicState("operational")).toBe("up");
    expect(verdictPublicState("degraded")).toBe("degraded");
    expect(verdictPublicState("outage")).toBe("down");
    expect(verdictPublicState("stale")).toBe("stale");
    expect(verdictPublicState("empty")).toBe("unknown");
  });

  it("averages the days with data for the 90-day uptime", () => {
    const day = (uptime: number | null) => ({ day: "2026-09-01", worst: null, uptime, minutesDown: 0 });
    expect(uptime90dOf({ beats90d: [day(null), day(null)] })).toBeNull();
    expect(uptime90dOf({ beats90d: [day(1), day(0.5), day(null)] })).toBe(0.75);
  });
});

describe("which sites are published", () => {
  it("needs a public page and public.enabled", () => {
    const on = { enabled: true, fields: [] };
    const off = { enabled: false, fields: [] };
    expect(isPublished({ visibility: "public", public: on })).toBe(true);
    expect(isPublished({ visibility: "public", public: off })).toBe(false);
    expect(isPublished({ visibility: "private", public: on })).toBe(false);
    expect(isPublished({ visibility: "private", public: off })).toBe(false);
  });
});
