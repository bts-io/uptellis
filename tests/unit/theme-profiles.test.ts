import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES } from "@/client/themes";
import type { Fact } from "@/shared/model";
import { registerProfile } from "@/shared/profiles";
import { buildSiteView, highlightSlots, type SiteView, type ViewInput } from "@/shared/view";
import { fixtureInput } from "../fixtures/view";

// Themes name no fact group or key: they render any profile's groups, highlights, headline and topology.

function fact(group: string, key: string, value: Fact["value"]): Fact {
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
  };
}

const viewWith = (edit: (i: ViewInput) => void): SiteView => {
  const input = fixtureInput("default");
  edit(input);
  return buildSiteView(input);
};

const render = (id: string, v: SiteView) =>
  renderToStaticMarkup(
    createElement(THEMES[id as keyof typeof THEMES]!.module.Page, { view: v, commit: null }),
  );

describe("themes on a site without profiles", () => {
  const plain = viewWith((i) => {
    i.config = { ...i.config, profiles: [] };
  });

  it.each(Object.keys(THEMES))("%s renders every group and its facts", (id) => {
    const html = render(id, plain);
    for (const g of plain.factGroups.filter((x) => !plain.highlights.some((h) => h.row.group === x.id)))
      expect(html.toLowerCase(), g.id).toContain(g.title.toLowerCase());
    expect(html).toMatch(/healthz code/i);
  });
});

describe("themes B and C with summary parts, slots and prefixes", () => {
  const v = viewWith(() => {});
  const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
  const literal = (t: string) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  // A group the view marks `inTopology` is drawn by the topology (B and C draw the pair), so it counts as
  // shown when the page carries the topology's own values; every other group needs its summary line.
  const listed = v.factGroups.filter((g) => !v.highlights.some((h) => h.row.group === g.id));
  const shown = listed.filter((g) => !g.inTopology);
  const carried = listed.filter((g) => g.inTopology);

  it.each(["b-control-room", "c-session"])(
    "%s renders every group's coloured parts and every highlight",
    (id) => {
      const html = render(id, v);
      for (const g of shown) {
        expect(text(html), g.id).toContain(g.summaryParts.map((p) => p.text).join(" "));
        for (const p of g.summaryParts.filter((x) => x.level === "ok"))
          expect(html, `${g.id} ${p.text}`).toMatch(
            new RegExp(`data-level="ok" class="text-up[^"]*">${literal(p.text)}<`),
          );
      }
      for (const slot of highlightSlots(v.highlights))
        for (const t of slot.texts) expect(text(html), t).toContain(t);
      expect(text(html)).toContain("db 41.2 MB");
    },
  );

  it.each(["b-control-room", "c-session"])("%s draws the groups the topology carries in its pair", (id) => {
    expect(carried.map((g) => g.id)).toEqual(["replication", "fence"]);
    const html = text(render(id, v));
    const topo = v.topology!;
    const edge = topo.edges.find((e) => e.kind === "replication")!;
    expect(edge.detail).toBe("lag 0 s");
    expect(html).toContain(edge.detail!);
    for (const n of topo.nodes.filter((x) => x.id === edge.from || x.id === edge.to))
      for (const d of n.details) expect(html, `${n.id} ${d.label}`).toContain(d.value);
    expect(html.toLowerCase()).toContain(topo.fence!.decision);
    expect(html).toContain(topo.fence!.reason!);
    expect(html).toContain(topo.fence!.detail!);
  });

  it("theme B still lists every row of every group it tiles", () => {
    const html = text(render("b-control-room", v));
    for (const r of shown.flatMap((g) => g.rows)) expect(html, `${r.group}.${r.key}`).toContain(r.display);
  });
});

describe("themes on a site without a topology", () => {
  const v = viewWith((i) => {
    i.config = { ...i.config, topology: undefined };
  });
  const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");

  it.each(Object.keys(THEMES))("%s lists the groups a topology would carry", (id) => {
    expect(v.factGroups.some((g) => g.inTopology)).toBe(false);
    const html = text(render(id, v)).toLowerCase();
    for (const g of v.factGroups.filter((x) => x.id === "replication" || x.id === "fence"))
      expect(html, g.id).toContain(g.title.toLowerCase());
  });

  it.each(["b-control-room", "c-session"])("%s shows their summary lines", (id) => {
    const html = text(render(id, v));
    for (const g of v.factGroups.filter((x) => x.id === "replication" || x.id === "fence"))
      expect(html, g.id).toContain(g.summaryParts.map((p) => p.text).join(" "));
  });
});

describe("a new profile", () => {
  // Added here, in a test: no view-model or theme code knows it.
  registerProfile({
    id: "acme-queue",
    name: "Acme queue",
    description: "A message queue.",
    groups: [
      {
        id: "queue",
        title: "Message queue",
        icon: "database",
        order: 5,
        keys: [
          {
            key: "depth",
            label: "Depth",
            format: "number",
            unit: "msgs",
            level: (f) => (f.value.type === "number" && f.value.value > 100 ? "warn" : "ok"),
          },
          { key: "consumers", label: "Consumers", format: "number" },
        ],
        summary: (ctx) => {
          const depth = ctx.facts.get("queue.depth")?.value;
          return depth?.type === "number" ? `${depth.value} waiting` : null;
        },
      },
    ],
    highlights: [{ fact: "queue.depth", label: "queue", note: () => ({ text: "backlog", level: "warn" }) }],
    headline: () => "Queue draining",
    topology: (_ctx, t) => ({
      ...t,
      nodes: t.nodes.map((n) =>
        n.id === "runner-1"
          ? { ...n, note: "consumer", details: [{ label: "queue", value: "3", state: "up" }] }
          : n,
      ),
    }),
  });

  const v = viewWith((i) => {
    i.config = { ...i.config, profiles: ["acme-queue", "forgejo-ha"] };
    i.model.facts = [
      ...i.model.facts,
      fact("queue", "depth", { type: "number", value: 240 }),
      fact("queue", "consumers", { type: "number", value: 3 }),
    ];
  });

  it("shapes the view: group order, rows, levels, highlights, headline and topology", () => {
    expect(v.factGroups[0]).toMatchObject({ id: "queue", title: "Message queue", icon: "database" });
    expect(v.factGroups[0]!.summary).toBe("240 waiting");
    expect(v.factGroups[0]!.rows.map((r) => [r.label, r.display, r.level])).toEqual([
      ["Depth", "240 msgs", "warn"],
      ["Consumers", "3", null],
    ]);
    // Without a slot it follows the slotted built-ins.
    expect(v.highlights.at(-1)).toMatchObject({
      label: "queue",
      note: { text: "backlog", level: "warn" },
      slot: null,
    });
    expect(v.headline).toBe("Queue draining");
    expect(v.topology!.nodes.find((n) => n.id === "runner-1")).toMatchObject({ note: "consumer" });
    // forgejo-ha still refines the pair after it.
    expect(v.topology!.nodes.find((n) => n.id === "app-1")!.note).toBe("serving");
  });

  it.each(Object.keys(THEMES))("%s renders it without knowing it", (id) => {
    const html = render(id, v);
    expect(html).toContain("240");
    expect(html).toContain("backlog");
  });
});
