import { describe, expect, it } from "vitest";
import type { Fact } from "@/shared/model";
import { activeProfiles, listProfiles, type Profile, registerProfile } from "@/shared/profiles";
import { lastKnown, staleAge } from "@/shared/profiles/read";
import { buildSiteView, type SiteView, type ViewInput } from "@/shared/view";
import { buildFactViews, latestFacts, profileContext } from "@/shared/view/facts";
import { fixtureConfig, fixtureInput } from "../fixtures/view";

const NOW = Date.parse("2026-09-27T23:58:00Z");
const ids = (ps: Profile[]) => ps.map((p) => p.id);

function fact(group: string, key: string, value: Fact["value"], over: Partial<Fact> = {}): Fact {
  return {
    site: "demo",
    source: "facts:app-1",
    group,
    key,
    value,
    unit: null,
    severity: null,
    observedAt: "2026-09-27T23:45:00Z",
    freshForS: 1800,
    ...over,
  };
}

/** The default fixture with `edit` applied to a copy of its input. */
const viewWith = (edit: (i: ViewInput) => void): SiteView => {
  const input = fixtureInput("default");
  edit(input);
  return buildSiteView(input);
};

describe("registry and activation", () => {
  it("lists the built-in profiles, generic first", () => {
    expect(ids(listProfiles()).slice(0, 3)).toEqual(["generic", "forgejo-ha", "uptime-kuma"]);
  });

  it("activates generic, then the config's profiles in order, then uptime-kuma for a Kuma source", () => {
    expect(ids(activeProfiles({ profiles: [], sources: [] }))).toEqual(["generic"]);
    expect(ids(activeProfiles(fixtureConfig))).toEqual(["generic", "forgejo-ha", "uptime-kuma"]);
    const kuma = [{ id: "kuma:watch-1", kind: "kuma" as const, expectedIntervalS: 60 }];
    expect(
      ids(activeProfiles({ profiles: ["uptime-kuma", "nope", "forgejo-ha", "generic"], sources: kuma })),
    ).toEqual(["generic", "uptime-kuma", "forgejo-ha"]);
  });

  it("refuses a duplicate or invalid profile id", () => {
    const p: Profile = { id: "forgejo-ha", name: "x", description: "x", groups: [] };
    expect(() => registerProfile(p)).toThrow(/already registered/);
    expect(() => registerProfile({ ...p, id: "Bad Id" })).toThrow(/Invalid profile id/);
  });
});

describe("generic formatting", () => {
  const generic = activeProfiles({ profiles: [], sources: [] });
  const rows = (facts: Fact[]) =>
    buildFactViews(facts, { nowMs: NOW, thresholds: fixtureConfig.thresholds, profiles: generic });

  it("labels and formats any key from its type and unit, and folds nothing", () => {
    const v = rows([
      fact("forgejo", "healthzCode", { type: "number", value: 502 }),
      fact("forgejo", "healthzOk", { type: "boolean", value: false }),
      fact("backup", "lastAt", { type: "timestamp", value: "2026-09-27T23:31:00Z" }),
      fact("backup", "nextAt", { type: "timestamp", value: "2026-09-28T01:00:00Z" }),
      fact("disk", "usedBytes", { type: "number", value: 2048 }, { unit: "bytes" }),
      fact("disk", "percent", { type: "number", value: 85 }, { unit: "%" }),
      fact("replication", "lagSeconds", { type: "number", value: 3700 }, { unit: "s" }),
    ]);
    expect(v.groups.map((g) => [g.id, g.title, g.icon, g.summary])).toEqual([
      ["backup", "Backup", null, null],
      ["disk", "Disk", null, null],
      ["forgejo", "Forgejo", null, null],
      ["replication", "Replication", null, null],
    ]);
    const shown = (k: string) => [v.index[k]!.label, v.index[k]!.display, v.index[k]!.level];
    expect(shown("forgejo.healthzCode")).toEqual(["Healthz code", "502", null]);
    expect(shown("forgejo.healthzOk")).toEqual(["Healthz ok", "no", null]);
    expect(shown("backup.lastAt")).toEqual(["Last at", "27 min ago", null]);
    expect(shown("backup.nextAt")).toEqual(["Next at", "in 1 h 2 min", null]);
    expect(shown("disk.usedBytes")).toEqual(["Used bytes", "2.0 KiB", null]);
    expect(shown("disk.percent")).toEqual(["Percent", "85%", null]);
    expect(v.index["disk.percent"]!.percent).toBe(85);
    expect(shown("replication.lagSeconds")).toEqual(["Lag seconds", "1 h 1 min", null]);
    expect(v.groups.find((g) => g.id === "forgejo")!.rows).toHaveLength(2);
    expect(v.highlights).toEqual([]);
    expect(v.headline).toBeNull();
  });

  it("applies each declared format, falling back to the inferred one on a type mismatch", () => {
    const formats: Profile = {
      id: "formats",
      name: "Formats",
      description: "Every format once.",
      groups: [
        {
          id: "f",
          title: "Formats",
          order: 1,
          keys: [
            { key: "list", label: "List", format: "list" },
            { key: "due", label: "Due", format: "until" },
            { key: "at", label: "At", format: "timestamp" },
            { key: "on", label: "On", format: "bool", labels: ["enabled", "disabled"] },
            { key: "size", label: "Size", format: "bytes" },
            { key: "count", label: "Count", format: "number", unit: "jobs" },
            { key: "skew", label: "Skew", format: "age" },
          ],
        },
      ],
    };
    const v = buildFactViews(
      [
        fact("f", "list", { type: "string", value: "a,b\nc" }),
        fact("f", "due", { type: "timestamp", value: "2026-09-27T23:00:00Z" }),
        fact("f", "at", { type: "timestamp", value: "2026-09-27T23:00:00Z" }),
        fact("f", "on", { type: "boolean", value: false }),
        fact("f", "size", { type: "string", value: "1.2 GiB" }),
        fact("f", "count", { type: "number", value: 3 }),
        fact("f", "skew", { type: "timestamp", value: "2026-09-28T00:00:30Z" }),
      ],
      { nowMs: NOW, thresholds: fixtureConfig.thresholds, profiles: [formats] },
    );
    expect(v.groups[0]!.rows.map((r) => r.display)).toEqual([
      "a, b, c",
      "due now",
      "2026-09-27 23:00:00 UTC",
      "disabled",
      "1.2 GiB",
      "3 jobs",
      "just now",
    ]);
  });
});

describe("a site without profiles", () => {
  const plain = viewWith((i) => {
    i.config = { ...i.config, profiles: [] };
  });

  it("still renders every fact plainly, with only the collector's profile active", () => {
    const facts = fixtureInput("default").model.facts;
    expect(Object.keys(plain.factIndex)).toHaveLength(facts.length);
    const shown = plain.factGroups.flatMap((g) => g.rows.map((r) => `${r.group}.${r.key}`));
    expect(shown).toHaveLength(facts.length);
    expect(plain.factIndex["forgejo.healthzCode"]!.display).toBe("200");
    expect(plain.headline).toBeNull();
    expect(plain.highlights.map((h) => h.row.group)).toEqual(["kuma", "kuma", "kuma", "kuma"]);
    expect(plain.topology!.fence).toBeNull();
    expect(plain.topology!.nodes.every((n) => n.details.length === 0)).toBe(true);
  });
});

describe("forgejo-ha: a lag past its freshness window", () => {
  /** The default fixture with the lag fact's window cut to `freshForS`; the state stays current. */
  const lagWindow = (freshForS: number, edit: (i: ViewInput) => void = () => {}) =>
    viewWith((i) => {
      i.model.facts = i.model.facts.map((f) =>
        f.group === "replication" && f.key === "lagSeconds" ? { ...f, freshForS } : f,
      );
      edit(i);
    });
  const wal = (v: SiteView) => v.topology!.nodes.find((n) => n.id === "app-2")!.details.at(-1);
  const edge = (v: SiteView) => v.topology!.edges.find((e) => e.kind === "replication")!;
  const lagPart = (v: SiteView) => {
    const parts = v.factGroups.find((g) => g.id === "replication")!.summaryParts;
    return parts[parts.findIndex((p) => p.text === "lag") + 1];
  };

  it("keeps showing the current lag plainly", () => {
    const v = lagWindow(1800);
    expect(wal(v)).toEqual({ label: "wal", value: "lag 0 s", state: "up" });
    expect(edge(v)).toMatchObject({ live: true, detail: "lag 0 s" });
    expect(lagPart(v)).toEqual({ text: "0 s", level: "ok", emphasis: false });
  });

  it("shows the last known lag with its age, stale, never a word in its place", () => {
    // Observed at 23:45 with a 10 minute window: 13 minutes old at 23:58.
    const v = lagWindow(600);
    expect(wal(v)).toEqual({ label: "wal", value: "lag 0 s, 13 min ago", state: "stale" });
    expect(edge(v)).toMatchObject({ live: true, detail: "lag 0 s, 13 min ago" });
    expect(lagPart(v)).toEqual({ text: "0 s, 13 min ago", level: "info", emphasis: false });
    expect(v.headline).toBe("Forgejo serving from app-1, replication streaming");
    expect(JSON.stringify(v.topology)).not.toContain(':"live"');
  });

  it("keeps the last lag in the headline when every replication fact is past its window", () => {
    const v = lagWindow(1800, (i) => {
      i.now = "2026-09-28T00:25:00Z";
      for (const s of i.model.sources) s.lastSeenAt = "2026-09-28T00:24:30Z";
    });
    expect(edge(v)).toMatchObject({ live: false, detail: "lag 0 s, 40 min ago" });
    expect(wal(v)).toMatchObject({ value: "stopped" });
    expect(v.headline).toBe("Forgejo serving from app-1, replication lag 0 s, 40 min ago");
  });

  it("still says why nothing streams once the state tells", () => {
    const v = lagWindow(600, (i) => {
      const state = i.model.facts.find((f) => f.group === "replication" && f.key === "state")!;
      state.value = { type: "string", value: "none" };
    });
    expect(edge(v)).toMatchObject({ live: false, detail: "no standby streaming" });
  });
});

describe("groups the topology carries", () => {
  const carried = (v: SiteView) => v.factGroups.filter((g) => g.inTopology).map((g) => g.id);

  it("marks replication and fence on a site with the pair, nothing else", () => {
    expect(carried(viewWith(() => {}))).toEqual(["replication", "fence"]);
  });

  it("marks nothing on a site without a topology or without the profile", () => {
    expect(carried(viewWith((i) => (i.config = { ...i.config, topology: undefined })))).toEqual([]);
    expect(carried(viewWith((i) => (i.config = { ...i.config, profiles: [] })))).toEqual([]);
  });

  it("asks the profile with the refined topology: no replication edge, no replication mark", () => {
    const v = viewWith((i) => {
      const t = i.config.topology!;
      i.config = { ...i.config, topology: { ...t, edges: t.edges.filter((e) => e.kind !== "replication") } };
    });
    expect(carried(v)).toEqual(["fence"]);
  });
});

describe("last known values (read helpers, any profile)", () => {
  const ctx = (facts: Fact[], stale: string[] = []) =>
    profileContext(latestFacts(facts), {
      nowMs: NOW,
      thresholds: fixtureConfig.thresholds,
      sourceStale: (id) => stale.includes(id),
    });
  const depth = (over: Partial<Fact> = {}) => fact("queue", "depth", { type: "number", value: 7 }, over);

  it("leaves a current value as is and has no age for it", () => {
    const c = ctx([depth()]);
    expect(staleAge(c, "queue.depth")).toBeNull();
    expect(lastKnown(c, "queue.depth", "7 waiting")).toBe("7 waiting");
  });

  it("marks a value past its window, or from a stale source, with its age", () => {
    expect(lastKnown(ctx([depth({ freshForS: 60 })]), "queue.depth", "7 waiting")).toBe(
      "7 waiting, 13 min ago",
    );
    expect(lastKnown(ctx([depth()], ["facts:app-1"]), "queue.depth", "7 waiting")).toBe(
      "7 waiting, 13 min ago",
    );
  });

  it("has no age for a fact that never arrived", () => {
    expect(staleAge(ctx([]), "queue.depth")).toBeNull();
    expect(lastKnown(ctx([]), "queue.depth", "-")).toBe("-");
  });
});
