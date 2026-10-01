import { describe, expect, it } from "vitest";
import { activeProfiles } from "@/shared/profiles";
import { buildSiteView, type SiteView } from "@/shared/view";
import { currentFacts, factsBySource, latestFacts } from "@/shared/view/facts";
import { facts, NOW, n, pairView, primary, standby } from "../fixtures/pair";
import { fixtureConfig, fixtureInput } from "../fixtures/view";

// A forgejo-ha pair with a pusher on each node (facts:app-1 and facts:app-2): the view reads the pair from
// the primary, disk per node.

const row = (v: SiteView, key: string) => v.factIndex[key]?.display;
const node = (v: SiteView, id: string) => v.topology?.nodes.find((x) => x.id === id);
const detail = (v: SiteView, id: string, label: string) =>
  node(v, id)?.details.filter((d) => d.label === label);
const summary = (v: SiteView, id: string) => v.factGroups.find((g) => g.id === id)?.summary;

describe("forgejo-ha with a pusher on each node", () => {
  const early = "2026-09-27T23:44:00Z";
  const late = "2026-09-27T23:46:00Z";

  it.each([
    ["the standby pushed last", early, late],
    ["the primary pushed last", late, early],
  ])("reads the pair from the primary when %s", (_, primaryAt, standbyAt) => {
    const v = pairView([
      ...primary("app-1", "app-2", "facts:app-1", primaryAt),
      ...standby("app-2", "app-1", "facts:app-2", standbyAt),
    ]);
    expect(v.headline).toBe("Forgejo serving from app-1, replication streaming");
    expect(row(v, "forgejo.node")).toBe("app-1");
    expect(row(v, "replication.role")).toBe("primary");
    expect(row(v, "replication.peerReachable")).toBe("yes");
    expect(row(v, "replication.standbyConnected")).toBe("yes");
    expect(row(v, "backup.lastResult")).toBe("ok");
    // The standby's own keys never mix in.
    expect(v.factIndex["backup.nextScheduled"]).toBeUndefined();
    expect(summary(v, "replication")).toContain("streaming");
    expect(summary(v, "replication")).toContain("peer app-2 (reachable yes)");
    expect(v.topology?.edges.find((e) => e.kind === "replication")?.live).toBe(true);
    expect(node(v, "app-1")).toMatchObject({ state: "up", note: "serving" });
    expect(node(v, "app-2")).toMatchObject({ state: "up", note: "standby" });
  });

  it("shows each node's disk: the Disk group, its summary and the pair's cards", () => {
    const v = pairView([
      ...primary("app-1", "app-2", "facts:app-1", early, 16),
      ...standby("app-2", "app-1", "facts:app-2", late, 83),
    ]);
    const disk = v.factGroups.find((g) => g.id === "disk")!;
    expect(disk.rows.map((r) => [r.key, r.label, r.display, r.node])).toEqual([
      ["percent", "Root filesystem (app-1)", "16%", "app-1"],
      ["display", "Used (app-1)", "12G / 79G (16%)", "app-1"],
      ["percent@app-2", "Root filesystem (app-2)", "83%", "app-2"],
      ["display@app-2", "Used (app-2)", "9G / 79G (83%)", "app-2"],
    ]);
    expect(disk.level).toBe("warn");
    expect(disk.fresh).toBe(true);
    expect(disk.summary).toBe("app-1 12G / 79G (16%) · app-2 9G / 79G (83%)");
    // The view's own `disk.percent` is the primary's; the standby's row is indexed under its node.
    expect(row(v, "disk.percent")).toBe("16%");
    expect(row(v, "disk.percent@app-2")).toBe("83%");
    expect(detail(v, "app-1", "disk")).toEqual([{ label: "disk", value: "16%", state: "up" }]);
    expect(detail(v, "app-2", "disk")).toEqual([{ label: "disk", value: "83%", state: "degraded" }]);
    // The standby's card keeps its wal row before its disk.
    expect(node(v, "app-2")?.details.map((d) => d.label)).toEqual(["forgejo", "postgres", "wal", "disk"]);
  });

  it("follows the new primary after a failover", () => {
    // app-2 took over: it serves as primary; app-1 came back as its standby.
    const v = pairView([
      ...standby("app-1", "app-2", "facts:app-1", late),
      ...primary("app-2", "app-1", "facts:app-2", early),
    ]);
    expect(v.headline).toBe("Forgejo serving from app-2, replication streaming");
    expect(row(v, "forgejo.node")).toBe("app-2");
    expect(row(v, "replication.peer")).toBe("app-1");
    expect(node(v, "app-2")).toMatchObject({ state: "up", note: "serving" });
    expect(node(v, "app-1")).toMatchObject({ state: "up", note: "standby" });
    expect(row(v, "disk.percent")).toBe("16%");
    expect(row(v, "disk.percent@app-1")).toBe("12%");
  });

  it("takes the newer report while both nodes still claim the primary", () => {
    const v = pairView([
      ...primary("app-1", "app-2", "facts:app-1", early),
      ...primary("app-2", "app-1", "facts:app-2", late),
    ]);
    expect(v.headline).toBe("Forgejo serving from app-2, replication streaming");
  });

  it("falls back to the standby's view, the primary marked stale, once the primary's facts are stale", () => {
    const old = "2026-09-27T23:00:00Z"; // 58 min before now, past the 30 min window
    const v = pairView([
      ...primary("app-1", "app-2", "facts:app-1", old),
      ...standby("app-2", "app-1", "facts:app-2", late),
    ]);
    expect(row(v, "forgejo.node")).toBe("app-2");
    expect(row(v, "replication.role")).toBe("standby");
    // The standby reports no replication state of its own, so the headline makes no replication claim.
    expect(v.headline).toBe("Forgejo serving from app-1");
    expect(node(v, "app-1")?.state).toBe("stale");
    expect(detail(v, "app-1", "disk")).toEqual([{ label: "disk", value: "16%, 58 min ago", state: "stale" }]);
    const disk = v.factGroups.find((g) => g.id === "disk")!;
    expect(disk.fresh).toBe(false);
    expect(disk.observedAt).toBe(old);
    expect(disk.rows.map((r) => r.key)).toEqual(["percent@app-1", "display@app-1", "percent", "display"]);
  });

  it("keeps the primary's view while it is current, whatever the standby says", () => {
    const v = pairView([
      ...primary("app-1", "app-2", "facts:app-1", early),
      ...standby("app-2", "app-1", "facts:app-2", "2026-09-27T23:00:00Z"),
    ]);
    expect(row(v, "forgejo.node")).toBe("app-1");
    expect(node(v, "app-2")?.state).toBe("stale");
  });
});

describe("one facts source behaves as before", () => {
  const profiles = activeProfiles(fixtureConfig);
  const ctx = { nowMs: NOW, thresholds: fixtureConfig.thresholds, config: fixtureConfig, profiles };

  it("keeps the newest fact per key and lists no node on any row", () => {
    const model = fixtureInput("default").model;
    const current = currentFacts(model.facts, ctx);
    expect([...current.facts]).toEqual([...latestFacts(model.facts)]);
    expect(current.sources.map((x) => [x.source, x.node])).toEqual([
      ["facts:app-1", "app-1"],
      ["kuma:watch-1", "watch-1"],
    ]);
    const v = buildSiteView(fixtureInput("default"));
    expect(v.factGroups.flatMap((g) => g.rows).filter((r) => r.node !== undefined)).toEqual([]);
    expect(Object.keys(v.factIndex).filter((k) => k.includes("@"))).toEqual([]);
  });

  it("merges several sources newest first when no profile picks", () => {
    const a = facts("facts:a", "2026-09-27T23:40:00Z", [["queue", "depth", n(1)]]);
    const b2 = facts("facts:b", "2026-09-27T23:50:00Z", [["queue", "depth", n(2)]]);
    const generic = activeProfiles({ profiles: [], sources: [] });
    const current = currentFacts([...a, ...b2], { ...ctx, profiles: generic });
    expect(current.facts.get("queue.depth")?.value).toEqual(n(2));
    expect(factsBySource([...a, ...b2], generic).map((x) => x.node)).toEqual(["a", "b"]);
  });
});
