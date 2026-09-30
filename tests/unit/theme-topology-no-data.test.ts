// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES } from "@/client/themes";
import { buildSiteView, edgeState, type SiteView, type ViewInput } from "@/shared/view";
import { fixtureInput, type ViewFixtureName } from "../fixtures/view";

// A site whose config declares the pair but that has no facts at all (a retired facts source, or a new
// install before its pusher first reports) knows nothing about replication: no theme may call it stopped.

const viewOf = (name: ViewFixtureName, edit: (i: ViewInput) => void = () => {}): SiteView => {
  const input = fixtureInput(name);
  edit(input);
  return buildSiteView(input);
};

const noFacts = (i: ViewInput) => {
  i.model.facts = [];
  i.model.openIncidents = [];
  i.model.recentIncidents = [];
};

const variants: [string, SiteView][] = [
  ["services absent", viewOf("default", (i) => (noFacts(i), (i.model.services = []), (i.history = [])))],
  [
    "services unknown",
    viewOf("default", (i) => {
      noFacts(i);
      i.model.services = i.model.services.map((s) => ({ ...s, status: "unknown" }));
    }),
  ],
];

const render = (id: string, v: SiteView) =>
  renderToStaticMarkup(
    createElement(THEMES[id as keyof typeof THEMES]!.module.Page, { view: v, commit: null }),
  );

const dom = (html: string) => {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
};

describe.each(variants)("a topology site with no facts, %s", (_, v) => {
  const edge = v.topology!.edges.find((e) => e.kind === "replication")!;

  it("knows nothing about the replication edge", () => {
    expect(edge).toMatchObject({ live: false, detail: null });
    expect(edgeState(edge, v.topology!.nodes)).toBe("unknown");
    expect(v.headline ?? "").not.toMatch(/stopped/);
    for (const n of v.topology!.nodes)
      for (const d of n.details) expect(`${n.id} ${d.label} ${d.value}`).not.toMatch(/stopped/);
  });

  it.each(Object.keys(THEMES))("%s claims no stopped edge, no red edge and no topology exit 1", (id) => {
    const el = dom(render(id, v));
    // A legend may name the stopped state; nothing else on the page may claim it.
    for (const legend of el.querySelectorAll("[data-legend]")) legend.remove();
    expect(el.textContent).not.toMatch(/stopped/i);
    for (const e of el.querySelectorAll("[data-edge]")) {
      expect(e.getAttribute("data-state") ?? "unknown", id).not.toBe("stopped");
      expect(e.className, id).not.toContain("text-down");
      expect(e.textContent, id).not.toContain("×");
    }
    const infra = el.querySelector("#infra");
    if (infra) {
      expect(infra.querySelector('[data-exit="1"]'), id).toBeNull();
      expect(infra.textContent, id).not.toContain("exit 1");
      expect(infra.hasAttribute("data-fail"), id).toBe(false);
    }
  });

  it.each(["a-sys-status", "b-control-room", "c-session"])("%s reads no data on the drawn edge", (id) => {
    const drawn = dom(render(id, v)).querySelector(`[data-edge="${edge.from}-${edge.to}"][data-state]`);
    expect(drawn?.getAttribute("data-state")).toBe("unknown");
    expect(drawn?.textContent?.toLowerCase()).toContain("no data");
  });
});

describe("a replication the data says stopped", () => {
  // The incident fixture reports replication state `none`: nothing streams, and the facts say so.
  const v = viewOf("incident");
  const edge = v.topology!.edges.find((e) => e.kind === "replication")!;

  it("stays stopped", () => {
    expect(edgeState(edge, v.topology!.nodes)).toBe("stopped");
  });

  it.each(["a-sys-status", "b-control-room", "c-session"])(
    "%s still draws it red and fails the infra block",
    (id) => {
      const el = dom(render(id, v));
      const drawn = el.querySelector(`[data-edge="${edge.from}-${edge.to}"][data-state]`)!;
      expect(drawn.getAttribute("data-state")).toBe("stopped");
      expect(drawn.className).toContain("text-down");
      expect(drawn.textContent).toContain("×");
      expect(drawn.textContent?.toLowerCase()).toContain("stopped");
    },
  );

  it.each(["a-sys-status", "c-session"])("%s counts it in the infra exit badge", (id) => {
    const infra = dom(render(id, v)).querySelector("#infra")!;
    expect(infra.textContent).toMatch(/exit\s*1/);
  });

  it("theme B raises the replication stopped chip", () => {
    expect(render("b-control-room", v)).toContain("replication stopped");
  });
});
