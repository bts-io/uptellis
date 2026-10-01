import { describe, expect, it } from "vitest";
import type { Heartbeat, Incident, Service } from "@/shared/model";
import { MonitorConfig, removedMonitorOf } from "@/shared/monitors";
import { buildSiteView, type SiteView } from "@/shared/view";
import { deriveRemovedMonitorIncidents, QUIET_NOTES, REMOVED_MONITOR_NOTE } from "@/worker/engine/incidents";
import { fixtureConfig, fixtureInput } from "../fixtures/view";

const T = (hms: string) => `2026-09-27T${hms}Z`;

function service(id: string, over: Partial<Service> = {}): Service {
  return {
    id,
    site: "demo",
    source: id.startsWith("probe:") ? "probe:cf" : "kuma:watch-1",
    externalId: id.slice(id.indexOf(":") + 1),
    name: `Service ${id}`,
    kind: "http",
    targetDisplay: "example.com/",
    intervalS: 60,
    status: "up",
    latencyMs: 100,
    avgLatencyMs: 100,
    uptime24h: 1,
    uptime30d: 1,
    ...over,
  };
}

const beat = (serviceId: string, ts: string, status: Heartbeat["status"] = "up"): Heartbeat => ({
  site: "demo",
  serviceId,
  ts,
  status,
  latencyMs: 100,
  message: null,
  important: true,
});

const down = (serviceId: string, startedAt: string, endedAt: string | null = null): Incident => ({
  id: `${serviceId}:${startedAt}`,
  site: "demo",
  kind: "down",
  serviceId,
  sourceId: null,
  startedAt,
  endedAt,
  title: `${serviceId} down`,
  notes: null,
});

/** A monitor on `builtin`, as the admin would save it. */
const monitor = (id: string, enabled = true) =>
  MonitorConfig.parse({ id, name: `Monitor ${id}`, type: "http", url: "https://example.org/", enabled });

/** The demo config (legacy probes `api-health`, `web-app`) plus a live and a paused monitor. */
const config = { ...fixtureConfig, monitors: [monitor("checkout"), monitor("paused-one", false)] };

const ids = (v: SiteView) => [...v.sections.flatMap((s) => s.services), ...v.unsectioned].map((s) => s.id);

describe("removedMonitorOf", () => {
  const removed = removedMonitorOf(config);

  it("keeps configured monitors, migrated legacy probes and paused monitors", () => {
    expect(removed("probe:checkout")).toBe(false);
    expect(removed("probe:paused-one")).toBe(false);
    expect(removed("probe:api-health")).toBe(false);
    expect(removed("probe:web-app")).toBe(false);
  });

  it("flags a probe service the config no longer defines", () => {
    expect(removed("probe:old-test")).toBe(true);
    expect(removedMonitorOf({ monitors: [], probes: [] })("probe:api-health")).toBe(true);
  });

  it("never flags services of other source kinds", () => {
    for (const id of ["kuma:1", "facts:app-1", "webhook:deploy", "kuma:old-test"])
      expect(removed(id)).toBe(false);
  });
});

describe("buildSiteView leaves removed monitors out", () => {
  function input() {
    const i = fixtureInput("default");
    const ts = new Date(Date.parse(i.now as string) - 20_000).toISOString().replace(".000Z", "Z");
    i.config = config;
    i.model.services = [
      ...i.model.services,
      service("probe:checkout"),
      service("probe:old-test", { status: "down", name: "Old test" }),
      service("kuma:99", { name: "Unconfigured Kuma" }),
    ];
    i.model.recentHeartbeats = [
      ...i.model.recentHeartbeats,
      beat("probe:checkout", ts),
      beat("probe:old-test", ts, "down"),
    ];
    const open = down("probe:old-test", T("23:00:00"));
    i.model.openIncidents = [...i.model.openIncidents, open];
    i.model.recentIncidents = [
      ...i.model.recentIncidents,
      open,
      down("probe:old-test", T("20:00:00"), T("20:10:00")),
    ];
    i.history = [...i.history, { serviceId: "probe:old-test", days: [] }];
    return i;
  }

  it("drops the removed monitor's service, beats and incidents; keeps the rest", () => {
    const v = buildSiteView(input());
    expect(ids(v)).toContain("probe:checkout");
    expect(ids(v)).toContain("kuma:99");
    expect(ids(v)).not.toContain("probe:old-test");
    expect(v.verdict.state).toBe("operational");
    expect(v.verdict.down).toBe(0);
    expect(v.incidents.open).toEqual([]);
    expect(v.incidents.recent.some((x) => x.serviceId === "probe:old-test")).toBe(false);
    expect(v.activity.some((a) => a.serviceId === "probe:old-test")).toBe(false);
    expect(v.activity.some((a) => a.serviceId === "probe:checkout")).toBe(true);
  });

  it("counts the removed monitor nowhere in the summary", () => {
    const base = buildSiteView({ ...fixtureInput("default"), config });
    // checkout already shows from its config (pending), so only the Kuma service is added; the removed
    // monitor is not.
    expect(buildSiteView(input()).summary.total).toBe(base.summary.total + 1);
  });

  it("shows the monitor again once the config defines it", () => {
    const i = input();
    i.config = { ...config, monitors: [...config.monitors, monitor("old-test")] };
    const v = buildSiteView(i);
    expect(ids(v)).toContain("probe:old-test");
    expect(v.incidents.open.map((x) => x.serviceId)).toEqual(["probe:old-test"]);
  });
});

describe("deriveRemovedMonitorIncidents", () => {
  const removed = removedMonitorOf(config);

  it("resolves only open down incidents of removed monitors, at now, with the note", () => {
    const gone = down("probe:old-test", T("10:00:00"));
    const kept = down("probe:checkout", T("10:00:00"));
    const kuma = down("kuma:1", T("10:00:00"));
    const closed = down("probe:old-test", T("08:00:00"), T("08:05:00"));
    const stale: Incident = {
      ...gone,
      id: "probe:cf:x",
      kind: "stale",
      serviceId: null,
      sourceId: "probe:cf",
    };
    const r = deriveRemovedMonitorIncidents({
      incidents: [gone, kept, kuma, closed, stale],
      now: T("11:00:00"),
      removed,
    });
    expect(r).toEqual({
      opened: [],
      resolved: [{ ...gone, endedAt: T("11:00:00"), notes: REMOVED_MONITOR_NOTE }],
    });
  });

  it("never ends an incident before it started", () => {
    const gone = down("probe:old-test", T("12:00:00"));
    const r = deriveRemovedMonitorIncidents({ incidents: [gone], now: T("11:00:00"), removed });
    expect(r.resolved[0]?.endedAt).toBe(T("12:00:00"));
  });

  it("is a quiet note (no card)", () => {
    expect(QUIET_NOTES.has(REMOVED_MONITOR_NOTE)).toBe(true);
  });
});
