import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES } from "@/client/themes";
import type { Fact } from "@/shared/model";
import { registerProfile } from "@/shared/profiles";
import { buildSiteView, type SiteView, type ViewInput } from "@/shared/view";
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
