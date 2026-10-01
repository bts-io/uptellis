import { describe, expect, it } from "vitest";
import type { Heartbeat, Service } from "@/shared/model";
import { MaintenanceWindow } from "@/shared/monitors";
import { buildSiteView, type ServiceView, type SiteView } from "@/shared/view";
import { buildPublicSummary, summaryService } from "@/worker/public/summary";
import { neverRunInput as input } from "../fixtures/never-run";
import { fixtureInput } from "../fixtures/view";

// A paused monitor (`enabled: false`) that never ran has no service row; an enabled one before its first
// result has none either. The view shows both from the config (issue #1: the paused machine's ping and SSH
// monitors were missing from the page and the dashboard). The dashboard's side is admin-ui-never-run.test.ts.

const all = (v: SiteView) => [...v.sections.flatMap((s) => s.services), ...v.unsectioned];
const svc = (v: SiteView, id: string): ServiceView => all(v).find((s) => s.id === id)!;

describe("a paused monitor that never ran", () => {
  const v = buildSiteView(input());

  it("shows in its section as paused with its config name, target and kind, and no data", () => {
    const lab = v.sections.find((s) => s.id === "lab")!;
    expect(lab.services.map((s) => [s.id, s.name, s.kind, s.targetDisplay, s.state, s.status])).toEqual([
      ["probe:lab-ping", "Lab machine ping", "ping", "lab.example.com", "paused", "paused"],
      ["probe:lab-ssh", "Lab machine SSH", "port", "lab.example.com:22", "paused", "paused"],
    ]);
    expect(lab.state).toBe("paused");
    const s = svc(v, "probe:lab-ping");
    expect(s).toMatchObject({ latencyMs: null, avgLatencyMs: null, uptime24h: null, uptime30d: null });
    expect(s.recent).toEqual([]);
    expect(s.spark).toEqual([]);
    expect(s.beats90d).toHaveLength(90);
    expect(s.beats90d.every((d) => d.worst === null)).toBe(true);
    expect(s.health).toEqual({ score: null, level: "ok", reasons: [] });
    expect(s.openIncidentId).toBeNull();
  });

  it("is never down or degraded: counted as other, the verdict unchanged", () => {
    const base = buildSiteView(fixtureInput("default"));
    expect(v.verdict).toEqual(base.verdict);
    expect(v.summary).toMatchObject({
      total: base.summary.total + 3,
      up: base.summary.up,
      down: 0,
      degraded: 0,
      other: base.summary.other + 3,
      avgLatencyMs: base.summary.avgLatencyMs,
      uptime30d: base.summary.uptime30d,
    });
  });

  it("stays paused, never stale, when the data is stale", () => {
    const s = buildSiteView(input("stale"));
    expect(svc(s, "probe:lab-ping").state).toBe("paused");
    expect(svc(s, "probe:lab-ssh").state).toBe("paused");
  });

  it("leaves the incident fixture's outage verdict as it was", () => {
    const inc = buildSiteView(input("incident"));
    const base = buildSiteView(fixtureInput("incident"));
    expect(inc.verdict).toEqual(base.verdict);
  });

  it("shows unsectioned when no section lists it", () => {
    const u = buildSiteView(input("default", (i) => (i.config.sections = i.config.sections.slice(0, -1))));
    expect(u.unsectioned.map((s) => [s.id, s.state])).toEqual([
      ["probe:lab-ping", "paused"],
      ["probe:lab-ssh", "paused"],
      ["probe:new-api", "pending"],
    ]);
  });

  it("shows paused inside a maintenance window too: it is not checked at all", () => {
    const window = MaintenanceWindow.parse({
      kind: "once",
      id: "w",
      title: "Window",
      services: [],
      start: "2026-09-27T23:00:00Z",
      end: "2026-09-28T01:00:00Z",
    });
    const m = buildSiteView(input("default", (i) => (i.config.maintenance = [window])));
    expect(svc(m, "probe:lab-ping").state).toBe("paused");
    expect(svc(m, "kuma:1").state).toBe("maintenance");
  });

  it("shows with an empty model, the verdict still empty", () => {
    const e = buildSiteView(
      input("default", (i) => {
        i.model = { ...i.model, sources: [], services: [], recentHeartbeats: [], facts: [] };
      }),
    );
    expect(e.verdict.state).toBe("empty");
    expect(e.sections.map((s) => s.id)).toEqual(["lab"]);
  });
});

describe("a paused monitor that ran before", () => {
  const row: Service = {
    id: "probe:lab-ping",
    site: "demo",
    source: "probe:office-1",
    externalId: "lab-ping",
    name: "Lab machine ping",
    kind: "ping",
    targetDisplay: "lab.example.com",
    intervalS: 60,
    status: "down",
    latencyMs: null,
    avgLatencyMs: 12,
    uptime24h: 0.9,
    uptime30d: 0.99,
  };
  const beat: Heartbeat = {
    site: "demo",
    serviceId: "probe:lab-ping",
    ts: "2026-09-27T20:00:00Z",
    status: "down",
    latencyMs: null,
    message: "no reply",
    important: true,
  };
  // Runners stop writing a paused monitor, so its row keeps its last status (here down) and its runner
  // source goes quiet; the view shows it paused, never down or stale, and keeps its beats.
  const v = buildSiteView(
    input("default", (i) => {
      i.model.services = [...i.model.services, row];
      i.model.recentHeartbeats = [...i.model.recentHeartbeats, beat];
    }),
  );

  it("shows paused, keeps its beats and uptime, and is not counted as down", () => {
    const s = svc(v, "probe:lab-ping");
    expect(s.state).toBe("paused");
    expect(s.status).toBe("paused");
    expect(s.recent.map((b) => b.status)).toEqual(["down"]);
    expect(s.uptime30d).toBe(0.99);
    expect(v.verdict.state).toBe("operational");
    expect(v.summary.down).toBe(0);
  });
});

describe("an enabled monitor that never ran", () => {
  const v = buildSiteView(input());

  it("shows unsectioned as pending from its config, counted as other", () => {
    expect(v.unsectioned.map((s) => s.id)).toEqual(["probe:new-api"]);
    const s = svc(v, "probe:new-api");
    expect(s).toMatchObject({
      name: "New API",
      kind: "http",
      targetDisplay: "api.example.org/v2",
      method: "GET",
      timeoutS: 10,
      intervalS: 60,
      state: "pending",
      latencyMs: null,
      uptime30d: null,
    });
    expect(s.recent).toEqual([]);
  });

  it("gives way to its row once it reports", () => {
    const ran = buildSiteView(
      input("default", (i) => {
        i.model.services = [
          ...i.model.services,
          {
            id: "probe:new-api",
            site: "demo",
            source: "probe:cf",
            externalId: "new-api",
            name: "New API",
            kind: "http",
            targetDisplay: "api.example.org/v2",
            intervalS: 60,
            status: "up",
            latencyMs: 80,
            avgLatencyMs: 80,
            uptime24h: 1,
            uptime30d: 1,
          },
        ];
      }),
    );
    expect(all(ran).filter((s) => s.id === "probe:new-api")).toHaveLength(1);
  });
});

describe("the public summary", () => {
  const v = buildSiteView(input());
  const s = buildPublicSummary(v, ["verdict", "sections", "serviceNames"]);

  it("shows the paused monitor as unknown, never down, and the verdict unchanged", () => {
    expect(summaryService(s, "probe:lab-ping")).toEqual({
      id: "probe:lab-ping",
      state: "unknown",
      name: "Lab machine ping",
    });
    expect(s.verdict).toEqual({ state: "operational", label: "All systems operational" });
  });

  it("shows a monitor before its first check as unknown, not as a failing (degraded) check", () => {
    const i = input();
    i.config.sections = [...i.config.sections, { id: "new", title: "New", services: ["probe:new-api"] }];
    expect(summaryService(buildPublicSummary(buildSiteView(i), ["sections"]), "probe:new-api")?.state).toBe(
      "unknown",
    );
  });
});
