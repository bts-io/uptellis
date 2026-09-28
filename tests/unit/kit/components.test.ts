// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  ActivityFeed,
  Age,
  Banner,
  BeatBar,
  ClientOnly,
  EmptyState,
  FactList,
  Footer,
  FreshnessChip,
  Gauge,
  Icon,
  type IconName,
  IncidentRail,
  KeyValueGrid,
  Panel,
  Sparkline,
  StaleBanner,
  StateDot,
  SummaryParts,
  TopologyTile,
  Verdict,
} from "../../../src/client/kit";
import { renderAnsiShadow } from "../../../src/client/kit/ansi-shadow";
import type { FreshnessView } from "../../../src/shared/view";
import { dom, render, view } from "./render";

const def = view("default");
const stale = view("stale");
const incident = view("incident");
const services = (v: typeof def) => v.sections.flatMap((s) => s.services);

describe("Banner", () => {
  it("draws the gradient block and shadow layers with the text as its name", () => {
    const el = dom(render(Banner, { text: "OPS", decrypt: true }));
    const root = el.firstElementChild!;
    expect(root.getAttribute("role")).toBe("img");
    expect(root.getAttribute("aria-label")).toBe("OPS");
    const pres = root.querySelectorAll("pre");
    // No noise layer on the server: the decrypt only runs after mount.
    expect(pres).toHaveLength(2);
    expect([...pres].every((p) => p.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(pres[0]!.className).toContain("opacity-62");
    expect(pres[1]!.className).toContain("text-gradient-brand");
    const [shadow, block] = [pres[0]!.textContent!, pres[1]!.textContent!];
    // Overlaid, the two layers give back the whole wordmark.
    const merged = [...block].map((c, i) => (c === " " ? shadow[i] : c)).join("");
    expect(merged).toBe(renderAnsiShadow("OPS"));
    expect(block.replace(/[█\s]/g, "")).toBe("");
    expect(shadow).not.toContain("█");
  });

  it("uses the small size when compact", () => {
    expect(dom(render(Banner, { text: "OK", compact: true })).firstElementChild!.className).toContain(
      "text-[11px]",
    );
    expect(dom(render(Banner, { text: "OK" })).firstElementChild!.className).toContain("md:text-[15px]");
  });
});

describe("Panel", () => {
  it("sets the title into the border as a heading, with aside and exit badge", () => {
    const el = dom(
      render(Panel, { title: "monitors", exitCode: 1, aside: "7/8 up", id: "monitors", children: "x" }),
    );
    const section = el.querySelector("section")!;
    expect(section.id).toBe("monitors");
    const h2 = section.querySelector("h2")!;
    expect(h2.textContent).toBe("monitors");
    expect(section.getAttribute("aria-labelledby")).toBe(h2.id);
    expect(section.textContent).toContain("[monitors]");
    expect(section.textContent).toContain("7/8 up");
    const exit = [...section.querySelectorAll("span")].find((s) => s.textContent === "exit 1")!;
    expect(exit.className).toContain("text-down");
  });

  it("omits the right label without aside or exit code and tints the border by level", () => {
    const html = render(Panel, { title: "infra", level: "crit", children: null });
    expect(html).not.toContain("exit");
    expect(dom(html).querySelector("section")!.className).toContain("border-down");
    expect(render(Panel, { title: "ok", exitCode: 0, children: null })).toContain("exit 0");
  });
});

describe("StateDot and Verdict", () => {
  it("labels the dot and draws stale as a hollow ring without a pulse", () => {
    const up = dom(render(StateDot, { state: "up", pulse: true })).firstElementChild!;
    expect(up.getAttribute("aria-label")).toBe("up");
    expect(up.className).toContain("text-up");
    expect(up.className).toContain("bg-current");
    expect(up.querySelector("span")!.className).toContain("motion-safe:animate-kit-ping");
    const st = dom(render(StateDot, { state: "stale", pulse: true, label: "stale data" })).firstElementChild!;
    expect(st.getAttribute("aria-label")).toBe("stale data");
    expect(st.className).toContain("text-stale");
    expect(st.className).not.toContain("bg-current");
    expect(st.querySelector("span")).toBeNull();
  });

  it("colours the verdict by state", () => {
    for (const [v, cls] of [
      [def, "text-up"],
      [stale, "text-stale"],
      [incident, "text-down"],
    ] as const) {
      const p = dom(render(Verdict, { verdict: v.verdict })).firstElementChild!;
      expect(p.getAttribute("role")).toBe("status");
      expect(p.textContent).toBe(v.verdict.label);
      expect(p.className).toContain(cls);
    }
  });
});

describe("freshness", () => {
  it("renders the chip for each state with the age at now", () => {
    const f: FreshnessView = { state: "fresh", ageS: 34, stalestSourceId: null, perSource: [] };
    expect(dom(render(FreshnessChip, { freshness: f, now: def.now })).textContent).toBe(
      "liveupdated 34s ago",
    );
    const a = dom(render(FreshnessChip, { freshness: { ...f, state: "aging", ageS: 150 }, now: def.now }));
    expect(a.textContent).toBe("agingupdated 2m 30s ago");
    expect(a.firstElementChild!.className).toContain("border-degraded/50");
    const s = dom(render(FreshnessChip, { freshness: { ...f, state: "stale", ageS: 862 }, now: def.now }));
    expect(s.textContent).toBe("stalelast report 14m 22s ago");
    const e = dom(render(FreshnessChip, { freshness: { ...f, state: "empty", ageS: null }, now: def.now }));
    expect(e.textContent).toBe("no datano source has reported");
  });

  it("shows the stale banner only when stale or empty", () => {
    expect(
      render(StaleBanner, { freshness: def.freshness, now: def.now, generatedAt: def.generatedAt }),
    ).toBe("");
    const html = render(StaleBanner, {
      freshness: stale.freshness,
      now: stale.now,
      generatedAt: stale.generatedAt,
    });
    const alert = dom(html).firstElementChild!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("SNAPSHOT STALE");
    expect(alert.textContent).toContain(`showing data from ${stale.generatedAt.slice(11, 19)} UTC`);
    const empty: FreshnessView = { state: "empty", ageS: null, stalestSourceId: null, perSource: [] };
    expect(render(StaleBanner, { freshness: empty, now: def.now, generatedAt: def.now })).toContain(
      "NO DATA YET",
    );
  });
});

describe("BeatBar", () => {
  it("renders 90 cells with the text form as the accessible name and copy payload", () => {
    const s = services(incident).find((x) => x.beats90d.some((d) => d.worst === "down"))!;
    const bar = dom(render(BeatBar, { days: s.beats90d, text: s.beatsText })).querySelector("[role=img]")!;
    expect(bar.getAttribute("aria-label")).toBe(s.beatsText);
    expect(bar.getAttribute("data-copy")).toBe(s.beatsText);
    expect(bar.getAttribute("tabindex")).toBe("0");
    const cells = bar.querySelectorAll("span");
    expect(cells).toHaveLength(90);
    expect([...cells].map((c) => c.getAttribute("data-worst"))).toEqual(
      s.beats90d.map((d) => d.worst ?? "none"),
    );
    expect(bar.querySelector("[data-worst=down]")!.className).toContain("bg-down");
    expect((bar as HTMLElement).style.height).toBe("18px");
  });

  it("hatches days without data", () => {
    const days = Array.from({ length: 90 }, (_, i) => ({
      day: `2026-06-${String((i % 30) + 1).padStart(2, "0")}-${i}`,
      worst: i < 85 ? ("up" as const) : null,
      uptime: i < 85 ? 1 : null,
      minutesDown: 0,
    }));
    const html = render(BeatBar, { days, text: `${"+".repeat(85)}.....`, height: 20 });
    const hatched = dom(html).querySelectorAll(".bg-hatch");
    expect(hatched).toHaveLength(5);
    expect(hatched[0]!.getAttribute("data-worst")).toBe("none");
    // No data is neutral, not stale: a theme may colour stale red.
    expect(hatched[0]!.className).toContain("text-faint");
    expect(hatched[0]!.className).not.toContain("stale");
    // No tooltip until hover or focus.
    expect(html).not.toContain('role="tooltip"');
  });
});

describe("Sparkline and Gauge", () => {
  it("draws a deterministic path in a fixed viewBox", () => {
    const props = { points: [371, 402, 389, 410, 377], label: "latency 371 to 410 ms" };
    const a = render(Sparkline, props);
    expect(a).toBe(render(Sparkline, props));
    const svg = dom(a).querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 300 40");
    expect(svg.getAttribute("aria-label")).toBe("latency 371 to 410 ms");
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    expect(svg.getAttribute("class")).toContain("text-up");
    const warn = dom(render(Sparkline, { ...props, level: "warn", width: 120, height: 30 })).querySelector(
      "svg",
    )!;
    expect(warn.getAttribute("viewBox")).toBe("0 0 120 30");
    expect(warn.getAttribute("class")).toContain("text-degraded");
  });

  it("draws a dashed baseline without points", () => {
    const svg = dom(render(Sparkline, { points: [], label: "no latency" })).querySelector("svg")!;
    expect(svg.querySelector("path")).toBeNull();
    expect(svg.querySelector("line")).not.toBeNull();
  });

  it("lights round(value / 100 * cells) of `cells` cells and exposes a meter", () => {
    const g = dom(render(Gauge, { value: 96.8, cells: 18, label: "health" })).firstElementChild!;
    expect(g.getAttribute("role")).toBe("meter");
    expect(g.getAttribute("aria-valuenow")).toBe("96.8");
    expect(g.querySelectorAll("i")).toHaveLength(18);
    expect(g.querySelectorAll("i[data-on]")).toHaveLength(17);
    const d = dom(render(Gauge, { value: 16, label: "disk", level: "crit" })).firstElementChild!;
    expect(d.querySelectorAll("i")).toHaveLength(10);
    expect(d.querySelectorAll("i[data-on]")).toHaveLength(2);
    expect(d.className).toContain("text-down");
    const n = dom(render(Gauge, { value: null, cells: 8, label: "lag" })).firstElementChild!;
    expect(n.getAttribute("role")).toBe("img");
    expect(n.getAttribute("aria-label")).toBe("lag: no data");
    expect(n.querySelectorAll("i[data-on]")).toHaveLength(0);
  });
});

describe("TopologyTile", () => {
  it("draws the replication pair with a flowing edge, the other nodes and the fence stamp", () => {
    const topo = def.topology!;
    const el = dom(render(TopologyTile, { topology: topo }));
    expect([...el.querySelectorAll("[data-node]")].map((n) => n.getAttribute("data-node"))).toEqual(
      topo.nodes.map((n) => n.id),
    );
    const edge = el.querySelector("[data-live]")!;
    expect(edge.getAttribute("data-live")).toBe("true");
    expect(edge.innerHTML).toContain("motion-safe:animate-kit-flow-x");
    expect(el.textContent).toContain(topo.fence!.decision);
    expect(el.querySelector(".border-gradient-brand")!.getAttribute("data-node")).toBe("app-1");
  });

  it("stops and breaks the edge when replication is not live", () => {
    // The incident fixture has replication stopped (Replica Postgres down).
    const edge = dom(render(TopologyTile, { topology: incident.topology! })).querySelector("[data-live]")!;
    expect(edge.getAttribute("data-live")).toBe("false");
    expect(edge.innerHTML).not.toContain("animate-kit-flow");
    expect(edge.textContent).toContain("×");
  });

  it("gives the pair cards their rows, a caption and a stamp naming the serving node", () => {
    const topo = def.topology!;
    const el = dom(
      render(TopologyTile, {
        topology: topo,
        caption: "forgejo failover pair",
        fenceDetail: "tl 1/1 · peer is a standby · 23:58",
        rows: {
          "app-1": [
            { label: "forgejo", value: "serving", state: "up" },
            { label: "disk", value: "16%", percent: 16, level: "ok" },
          ],
        },
      }),
    );
    expect(el.querySelector("figcaption")!.textContent).toBe("forgejo failover pair");
    const app1 = el.querySelector('[data-node="app-1"]')!;
    expect(app1.textContent).toContain("forgejoserving");
    expect(app1.querySelector('[role="meter"]')!.getAttribute("aria-valuenow")).toBe("16");
    // A node without rows keeps its state row; names are never truncated.
    const app2 = el.querySelector('[data-node="app-2"]')!;
    expect(app2.textContent).toContain("state");
    expect(app2.innerHTML).not.toContain("truncate text-[13px]");
    expect(el.textContent).toContain("primary=app-1");
    expect(el.textContent).toContain("tl 1/1 · peer is a standby · 23:58");
  });

  it("draws the nodes outside the pair as compact lines with the edges they start", () => {
    const el = dom(render(TopologyTile, { topology: def.topology! }));
    const watch1 = el.querySelector('li[data-node="watch-1"]')!;
    expect(watch1.querySelector('[data-edge="watch-1-app-1"]')!.textContent).toContain("watches");
    expect(el.querySelectorAll("div[data-node]")).toHaveLength(2);
  });

  it("stamps a failed fence in the crit colour and wraps the stopped edge's detail", () => {
    const topo = {
      ...incident.topology!,
      fence: { decision: "fenced", reason: "peer is primary", level: "crit" as const },
    };
    const el = dom(render(TopologyTile, { topology: topo }));
    expect(el.textContent).toContain("peer is primary");
    expect([...el.querySelectorAll("span")].find((s) => s.textContent === "fenced")!.className).toContain(
      "text-down",
    );
    const detail = el.querySelector('[data-live="false"]')!.lastElementChild!;
    expect(detail.innerHTML).toContain("no standby streaming");
    expect(detail.innerHTML).not.toContain("whitespace-nowrap");
  });
});

describe("ActivityFeed and IncidentRail", () => {
  it("renders one row per item with a level rule and tinted failures", () => {
    const items = incident.activity;
    const list = dom(render(ActivityFeed, { items, now: incident.now, columns: 2, limit: 6 })).querySelector(
      "ol",
    )!;
    const rows = list.querySelectorAll("li");
    expect(rows).toHaveLength(Math.min(6, items.length));
    expect(list.className).toContain("md:grid-cols-2");
    const crit = [...rows].find((r) => r.getAttribute("data-level") === "crit")!;
    expect(crit.className).toContain("bg-down/8");
    expect(crit.className).toContain("border-down");
    expect(rows[0]!.querySelector("time")!.textContent).toBe(items[0]!.ts.slice(11, 19));
    expect(rows[0]!.textContent).toContain("ago");
    expect(render(ActivityFeed, { items: [], now: def.now })).toContain("No activity yet");
  });

  it("lists checks after the events with their latency, limit counting both", () => {
    const s = services(incident).find((x) => x.state === "down")!;
    const checks = s.recent.map((beat) => ({ id: s.id, service: s.name, beat }));
    const items = incident.activity.slice(0, 2);
    const rows = dom(render(ActivityFeed, { items, checks, now: incident.now, limit: 4 })).querySelectorAll(
      "li",
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]!.getAttribute("data-level")).not.toBeNull();
    const check = rows[2]!;
    expect(check.getAttribute("data-check")).toBe(s.id);
    expect(check.textContent).toContain(s.name);
    expect(check.textContent).toContain("timeout");
    expect(check.className).toContain("bg-down/8");
    const up = services(def)[0]!;
    const upRow = dom(
      render(ActivityFeed, {
        items: [],
        checks: [{ id: up.id, service: up.name, beat: up.recent[0]! }],
        now: def.now,
      }),
    ).querySelector("li")!;
    expect(upRow.textContent).toContain(`${up.recent[0]!.latencyMs} ms`);
    expect(upRow.textContent).toContain("up");
  });

  it("shows the open incident with a live duration and a pending resolved step", () => {
    const inc = incident.incidents.open[0]!;
    const el = dom(render(IncidentRail, { incident: inc, now: incident.now }));
    expect(el.querySelector("h3")!.textContent).toBe(inc.title);
    const steps = el.querySelectorAll("ol li");
    expect(steps).toHaveLength(inc.steps.length + 1);
    expect(steps[steps.length - 1]!.textContent).toBe("resolved");
    expect(el.textContent).toContain("open ");
  });
});

describe("FactList, KeyValueGrid, Icon", () => {
  it("lists facts with gauges for percentages", () => {
    const rows = def.factGroups.flatMap((g) => g.rows);
    const el = dom(render(FactList, { rows }));
    expect(el.querySelectorAll("dt")).toHaveLength(rows.length);
    expect(el.querySelectorAll("[role=meter]")).toHaveLength(rows.filter((r) => r.percent !== null).length);
  });

  it("lays out the summary grid with icons, keys and values", () => {
    const items = [
      { icon: "grid" as const, label: "monitors", value: "8 total" },
      { icon: "bolt" as const, label: "avg resp", value: "212 ms" },
      { icon: "heart" as const, label: "health", value: "96.8" },
      { icon: "clock" as const, label: "uptime 30d", value: "99.94%" },
    ];
    const dl = dom(render(KeyValueGrid, { items, columns: 3 })).querySelector("dl")!;
    expect(dl.querySelectorAll("dt")).toHaveLength(4);
    expect(dl.querySelectorAll("svg")).toHaveLength(4);
    expect(dl.style.getPropertyValue("--kit-rows-lg")).toBe("repeat(2, auto)");
    expect(dl.className).toContain("lg:grid-cols-3");
  });

  it("draws every icon as a hidden outline svg", () => {
    const names: IconName[] = [
      "grid",
      "bolt",
      "box",
      "heart",
      "up",
      "clock",
      "host",
      "camera",
      "eye",
      "server",
      "database",
      "shield",
      "link",
      "alert",
      "check",
    ];
    for (const name of names) {
      const svg = dom(render(Icon, { name, size: 16 })).querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("width")).toBe("16");
      expect(svg.children.length).toBeGreaterThan(0);
    }
  });
});

describe("SummaryParts", () => {
  const parts = def.factGroups.find((g) => g.id === "replication")!.summaryParts;

  it("colours each part by level, mutes info, bolds emphasis and keeps the text", () => {
    const el = dom(render(SummaryParts, { parts }));
    expect(el.textContent).toBe(parts.map((p) => p.text).join(" "));
    const streaming = el.querySelector("[data-level=ok]")!;
    expect(streaming.textContent).toBe("streaming");
    expect(streaming.className).toContain("text-up");
    expect(streaming.className).toContain("font-semibold");
    expect(el.querySelector("[data-level=info]")!.className).toContain("text-muted");
  });

  it("drops the state colours on stale data", () => {
    const el = dom(render(SummaryParts, { parts, stale: true }));
    expect(el.innerHTML).not.toContain("text-up");
    expect(el.querySelector("[data-level=info]")!.className).toContain("text-muted");
  });
});

describe("EmptyState, Footer, Age, ClientOnly", () => {
  it("renders the empty state", () => {
    const el = dom(render(EmptyState, { title: "No monitors yet", detail: "No source has reported." }));
    expect(el.textContent).toBe("No monitors yetNo source has reported.");
  });

  it("puts real facts in the footer and skips unknown ones", () => {
    const html = render(Footer, {
      generatedAt: "2026-09-27T23:58:00Z",
      collectorHost: "watch-1",
      commit: "0123456789abcdef",
      hints: [
        { keys: "j k", label: "cards" },
        { keys: "i", label: "infra" },
      ],
    });
    const el = dom(html);
    expect(el.querySelector("p")!.textContent).toBe(
      "snapshot 23:58:00 UTC·collector watch-1·build 0123456·times UTC",
    );
    expect(el.querySelectorAll("kbd")).toHaveLength(3);
    const bare = dom(
      render(Footer, { generatedAt: "2026-09-27T23:58:00Z", collectorHost: null, commit: null }),
    );
    expect(bare.querySelector("p")!.textContent).toBe("snapshot 23:58:00 UTC·times UTC");
    expect(bare.querySelector("ul")).toBeNull();
  });

  it("renders the age at now on the server", () => {
    const html = render(Age, { since: "2026-09-27T23:55:12Z", now: "2026-09-27T23:58:34Z" });
    expect(html).toBe('<time dateTime="2026-09-27T23:55:12Z">3m 22s<!-- --> ago</time>');
    expect(
      render(Age, { since: "2026-09-27T23:55:12Z", now: "2026-09-27T23:55:46Z", suffix: false }),
    ).toContain("34s");
  });

  it("renders only the fallback on the server", () => {
    expect(render(ClientOnly, { children: "canvas", fallback: "static" })).toBe("static");
  });
});

describe("no terminal transplants", () => {
  it("never renders prompts, chevrons or access lines", () => {
    const html = [
      render(Panel, { title: "t", exitCode: 0, children: null }),
      render(Footer, { generatedAt: def.generatedAt, collectorHost: "watch-1", commit: null }),
      render(TopologyTile, { topology: def.topology! }),
      render(ActivityFeed, { items: incident.activity, now: incident.now }),
    ].join("");
    for (const bad of ["ACCESS GRANTED", "user@", "❯", "▸", "$ "]) expect(html).not.toContain(bad);
  });
});
