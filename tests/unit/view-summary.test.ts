import { describe, expect, it } from "vitest";
import { registerProfile } from "@/shared/profiles";
import {
  buildSiteView,
  type FactGroupView,
  highlightSlots,
  type SiteView,
  SUMMARY_SLOTS,
  type ViewInput,
} from "@/shared/view";
import { fixtureInput } from "../fixtures/view";

// Contract additions after 0.2.1: group summary parts, highlight slots and prefixes, the fence detail.

const view = (name: "default" | "incident" | "stale", edit?: (i: ViewInput) => void): SiteView => {
  const input = fixtureInput(name);
  edit?.(input);
  return buildSiteView(input);
};

const group = (v: SiteView, id: string) => v.factGroups.find((g) => g.id === id)!;
/** Parts as `text{level}`, `!` for emphasis, `-` for a plain part. */
const parts = (g: FactGroupView) =>
  g.summaryParts.map((p) => `${p.text}{${p.level ?? "-"}${p.emphasis ? "!" : ""}}`).join(" ");

describe("group summary parts", () => {
  const d = view("default");

  it("colours the built-in groups' values by level, secondary text as info", () => {
    expect(parts(group(d, "forgejo"))).toBe("16.0.5{-} ·{info} HTTP 200{ok} ·{info} serving app-1{info}");
    expect(parts(group(d, "replication"))).toBe(
      "streaming{ok!} lag{info} 0 s{ok} ·{info} primary{info} ·{info} peer app-2{info} (reachable yes){info} ·{info} standby connected yes{info}",
    );
    expect(parts(group(d, "fence"))).toMatch(/^SERVE\{ok!\} ·\{info\} timelines 1\/1\{info\}/);
    expect(parts(group(d, "disk"))).toBe("12G / 79G (16%){ok}");
    expect(parts(group(d, "watchdog"))).toBe("reachable (HTTP 200){ok}");
    expect(parts(group(d, "kuma"))).toBe("2.5.5{-} on watch-1{info}");
  });

  it("keeps the summary line as the parts' texts", () => {
    for (const g of d.factGroups) expect(g.summary).toBe(g.summaryParts.map((p) => p.text).join(" "));
    expect(group(d, "forgejo").summary).toBe("16.0.5 · HTTP 200 · serving app-1");
  });

  it("turns warnings amber in the incident", () => {
    const i = view("incident");
    expect(parts(group(i, "replication"))).toContain("none{warn!}");
    expect(parts(group(i, "replication"))).toContain("(reachable no){warn}");
  });

  it("makes a string-only summary one plain part, and a group without one has none", () => {
    registerProfile({
      id: "summary-string",
      name: "String summary",
      description: "A profile with a summary string only.",
      groups: [{ id: "queue", title: "Queue", order: 1, keys: [], summary: () => "3 waiting" }],
    });
    const v = view("default", (i) => {
      i.config = { ...i.config, profiles: ["summary-string"] };
      i.model.facts = [
        ...i.model.facts,
        { ...i.model.facts[0]!, group: "queue", key: "depth", value: { type: "number", value: 3 } },
        { ...i.model.facts[0]!, group: "misc", key: "note", value: { type: "string", value: "x" } },
      ];
    });
    expect(group(v, "queue").summaryParts).toEqual([{ text: "3 waiting", level: null, emphasis: false }]);
    expect(group(v, "misc")).toMatchObject({ summary: null, summaryParts: [] });
  });
});

describe("highlight slots", () => {
  it("orders highlights by slot: kuma after the average response, collector before the snapshot, watchdog last", () => {
    const d = view("default");
    expect(d.highlights.map((h) => [h.label, h.row.key, h.slot])).toEqual([
      ["kuma", "version", 30],
      ["kuma", "dbSize", 30],
      ["collector", "host", 70],
      ["collector", "timezone", 70],
      ["watchdog", "reachable", 90],
    ]);
    expect(highlightSlots(d.highlights).map((s) => [s.label, s.slot])).toEqual([
      ["kuma", 30],
      ["collector", 70],
      ["watchdog", 90],
    ]);
    const own = Object.values(SUMMARY_SLOTS);
    expect(own.filter((n) => n < 30)).toHaveLength(2);
    expect(own.filter((n) => n > 30 && n < 70)).toHaveLength(3);
  });

  it("puts highlights without a slot after the slotted ones, in profile order", () => {
    registerProfile({
      id: "slot-less",
      name: "Slot-less",
      description: "Highlights without slots.",
      groups: [],
      highlights: [
        { fact: "kuma.timezone", label: "zone" },
        { fact: "forgejo.version", label: "forgejo" },
        { fact: "disk.percent", label: "disk", slot: 5 },
      ],
    });
    const v = view("default", (i) => {
      i.config = { ...i.config, profiles: ["slot-less", "forgejo-ha"] };
    });
    expect(v.highlights.map((h) => `${h.label}:${h.slot ?? "-"}`)).toEqual([
      "disk:5",
      "kuma:30",
      "kuma:30",
      "collector:70",
      "watchdog:90",
      "zone:-",
      "forgejo:-",
    ]);
  });
});

describe("highlight prefixes", () => {
  it("names the database size within the Kuma slot", () => {
    const d = view("default");
    expect(d.highlights.find((h) => h.row.key === "dbSize")).toMatchObject({ prefix: "db" });
    expect(d.highlights.find((h) => h.row.key === "version")).toMatchObject({ prefix: null });
    const kuma = highlightSlots(d.highlights).find((s) => s.label === "kuma")!;
    expect(kuma.texts).toEqual(["2.5.5", "db 41.2 MB"]);
  });
});

describe("fence detail", () => {
  it("stamps the timelines the fence compared", () => {
    expect(view("default").topology!.fence).toMatchObject({ decision: "serve", detail: "tl 1/1" });
    expect(view("incident").topology!.fence!.detail).toBe("tl 1/-");
  });

  it("is null when no profile gives one", () => {
    registerProfile({
      id: "bare-fence",
      name: "Bare fence",
      description: "A fence without a detail.",
      groups: [],
      topology: (_ctx, t) => ({ ...t, fence: { decision: "hold", reason: null, level: "warn" } }),
    });
    const v = view("default", (i) => {
      i.config = { ...i.config, profiles: ["bare-fence"] };
    });
    expect(v.topology!.fence).toEqual({ decision: "hold", reason: null, level: "warn", detail: null });
  });
});
