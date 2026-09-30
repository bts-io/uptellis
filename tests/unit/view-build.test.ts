import { describe, expect, it } from "vitest";
import type { Fact, Heartbeat, Incident, Service } from "../../src/shared/model";
import { buildSiteView, type ServiceView, type SiteView, type ViewInput } from "../../src/shared/view";
import { fixtureConfig as config, fixtureInput, SITE_WIDE_WINDOW } from "../fixtures/view";

const NOW = "2026-09-27T23:58:00Z";
const view = (input: ViewInput) => buildSiteView(input);
const svc = (v: SiteView, id: string): ServiceView =>
  [...v.sections.flatMap((s) => s.services), ...v.unsectioned].find((s) => s.id === id)!;
const minutesBefore = (iso: string, m: number) =>
  new Date(Date.parse(iso) - m * 60_000).toISOString().replace(".000Z", "Z");

/** `c` with a `webhook:ci` source listed after the fixture's own. */
const withWebhook = (c: ViewInput["config"]): ViewInput["config"] => ({
  ...c,
  sources: [...c.sources, { id: "webhook:ci", kind: "webhook", expectedIntervalS: 300 }],
});

/** The default fixture with `edit` applied to a copy of its input. */
function edited(edit: (i: ViewInput) => void, name: "default" | "stale" | "incident" = "default"): SiteView {
  const input = fixtureInput(name);
  edit(input);
  return view(input);
}

function service(over: Partial<Service> & Pick<Service, "id">): Service {
  return {
    site: "demo",
    source: "kuma:watch-1",
    externalId: over.id.slice(over.id.indexOf(":") + 1),
    name: `Service ${over.id}`,
    kind: "http",
    targetDisplay: "status.example.com/",
    intervalS: 60,
    status: "up",
    latencyMs: 100,
    avgLatencyMs: 100,
    uptime24h: 1,
    uptime30d: 1,
    ...over,
  };
}

const beat = (serviceId: string, ts: string, over: Partial<Heartbeat> = {}): Heartbeat => ({
  site: "demo",
  serviceId,
  ts,
  status: "up",
  latencyMs: 100,
  message: null,
  important: false,
  ...over,
});

const fact = (group: string, key: string, value: Fact["value"], over: Partial<Fact> = {}): Fact => ({
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
});

describe("fixtures", () => {
  const d = view(fixtureInput("default"));
  const s = view(fixtureInput("stale"));
  const inc = view(fixtureInput("incident"));

  it("default: operational, fresh, all up, every section exit 0", () => {
    expect(d.verdict).toEqual({
      state: "operational",
      label: "All systems operational",
      down: 0,
      degraded: 0,
    });
    // All fresh: the age is the newest data (Kuma, 34 s), not the 15-minute facts probe.
    expect(d.freshness).toMatchObject({ state: "fresh", stalestSourceId: "facts:app-1", ageS: 34 });
    expect(d.summary).toMatchObject({ total: 8, up: 8, down: 0, degraded: 0, maintenance: 0, other: 0 });
    expect(d.sections.map((x) => [x.id, x.state, x.exitCode])).toEqual([
      ["web", "up", 0],
      ["database", "up", 0],
      ["access", "up", 0],
      ["workers", "up", 0],
    ]);
    expect(d.unsectioned).toEqual([]);
    expect(d.generatedAt).toBe("2026-09-27T23:57:26Z");
    expect(d.now).toBe(NOW);
    expect(d.incidents.open).toEqual([]);
    expect(d.incidents.recent).toHaveLength(4);
  });

  it("default: health scores are high for healthy services", () => {
    for (const x of d.sections.flatMap((sec) => sec.services)) {
      expect(x.health.score).toBeGreaterThanOrEqual(94);
      expect(x.health.score).toBeLessThanOrEqual(100);
      expect(x.health.level).toBe("ok");
    }
    expect(d.summary.healthScore).toBeGreaterThanOrEqual(94);
    expect(d.summary.avgLatencyMs).toBe(199.3);
    expect(d.summary.uptime24h).toBe(1);
  });

  it("default: beat bars carry the history's marks and end today", () => {
    const standby = svc(d, "kuma:5");
    expect(standby.beats90d.at(-1)!.day).toBe("2026-09-27");
    expect(standby.beats90d[0]!.day).toBe("2026-06-30");
    expect(standby.beatsText).toBe(`${"+".repeat(77)}xx${"+".repeat(11)}`);
    expect(standby.beats90d[77]).toMatchObject({ day: "2026-09-15", worst: "down", minutesDown: 42 });
    expect(svc(d, "kuma:1").beatsText.at(-3)).toBe("~");
  });

  it("default: recent is newest first and the spark oldest first", () => {
    const x = svc(d, "kuma:1");
    expect(x.recent.map((b) => b.ts)).toEqual([
      "2026-09-27T23:57:41Z",
      "2026-09-27T23:57:11Z",
      "2026-09-27T23:56:41Z",
      "2026-09-27T23:56:11Z",
      "2026-09-27T23:55:41Z",
    ]);
    expect(x.spark).toEqual([377, 410, 389, 402, 371]);
  });

  it("default: cert level ok with days recounted at now", () => {
    expect(svc(d, "kuma:1").cert).toMatchObject({ daysRemaining: 73, level: "ok", valid: true });
    expect(svc(d, "kuma:3").cert).toBeNull();
  });

  it("stale: kuma went quiet 14 minutes ago, so its services show stale and nothing is green", () => {
    expect(s.verdict.state).toBe("stale");
    expect(s.verdict.label).toBe("Data is stale");
    expect(s.freshness).toMatchObject({ state: "stale", stalestSourceId: "kuma:watch-1", ageS: 840 });
    expect(s.freshness.perSource.map((p) => [p.id, p.freshness])).toEqual([
      ["kuma:watch-1", "stale"],
      ["facts:app-1", "fresh"],
      ["probe:cf", "empty"],
    ]);
    const all = s.sections.flatMap((x) => x.services);
    expect(all.every((x) => x.state === "stale" && x.status === "up")).toBe(true);
    expect(s.sections.every((x) => x.state === "stale" && x.exitCode === 1)).toBe(true);
    expect(s.summary).toMatchObject({ up: 0, other: 8 });
    // The next UTC day has begun with no data yet: the bar's last cell is the no-data tail.
    expect(svc(s, "kuma:1").beatsText.at(-1)).toBe(".");
    expect(svc(s, "kuma:1").beats90d.at(-1)).toEqual({
      day: "2026-09-28",
      worst: null,
      uptime: null,
      minutesDown: 0,
    });
    expect(s.activity[0]).toMatchObject({
      kind: "source",
      sourceId: "kuma:watch-1",
      level: "warn",
      ts: "2026-09-28T00:02:26Z",
      title: "kuma:watch-1 went stale",
    });
    expect(s.factGroups.find((g) => g.id === "kuma")!.fresh).toBe(false);
    expect(s.factGroups.find((g) => g.id === "forgejo")!.fresh).toBe(true);
  });

  it("incident: Replica Postgres down is an outage with one open incident", () => {
    expect(inc.verdict).toEqual({ state: "outage", label: "1 service down", down: 1, degraded: 0 });
    const standby = svc(inc, "kuma:5");
    expect(standby).toMatchObject({ state: "down", openIncidentId: "kuma:5:2026-09-27T23:52:00Z" });
    expect(standby.health.level).toBe("crit");
    expect(standby.health.reasons[0]).toBe("down now");
    expect(standby.health.score).toBeLessThan(75);
    expect(standby.beatsText.at(-1)).toBe("x");
    expect(standby.spark).toEqual([]);
    expect(inc.sections.map((x) => [x.id, x.exitCode])).toEqual([
      ["web", 0],
      ["database", 1],
      ["access", 0],
      ["workers", 0],
    ]);
    expect(inc.sections[1]!.state).toBe("down");
    expect(inc.incidents.open).toEqual([
      {
        id: "kuma:5:2026-09-27T23:52:00Z",
        kind: "down",
        serviceId: "kuma:5",
        sourceId: null,
        subject: "Replica Postgres",
        title: "Replica Postgres down",
        startedAt: "2026-09-27T23:52:00Z",
        endedAt: null,
        durationS: 360,
        notes: null,
        steps: [{ ts: "2026-09-27T23:52:00Z", label: "Detected", level: "crit" }],
      },
    ]);
    // The transition beat that opened the incident is not repeated as a status row.
    expect(inc.activity[0]).toMatchObject({ kind: "incident-open", serviceId: "kuma:5", level: "crit" });
    expect(inc.activity.filter((a) => a.kind === "status")).toEqual([]);
  });

  it("incident: topology shows the standby down, replication not live, fence still serving", () => {
    const t = inc.topology!;
    expect(t.nodes.find((n) => n.id === "app-2")).toMatchObject({ state: "down", note: "standby" });
    expect(t.edges.find((e) => e.kind === "replication")).toMatchObject({
      live: false,
      detail: "no standby streaming",
    });
    expect(t.fence).toEqual({
      decision: "serve",
      reason: "peer is a standby",
      level: "ok",
      detail: "tl 1/-",
    });
    expect(inc.factGroups.find((g) => g.id === "replication")!.level).toBe("warn");
  });

  it("resolved incidents: newest first, with durations and a resolved step", () => {
    expect(d.incidents.recent.map((i) => [i.subject, i.endedAt, i.durationS])).toEqual([
      ["Replica Postgres", "2026-09-16T02:58:00Z", 1080],
      ["Replica SSH", "2026-09-16T02:58:00Z", 1080],
      ["Replica Postgres", "2026-09-15T03:52:00Z", 2520],
      ["Replica SSH", "2026-09-15T03:52:00Z", 2520],
    ]);
    expect(d.incidents.recent[0]!.steps.map((st) => st.label)).toEqual(["Detected", "Resolved"]);
    expect(d.activity[0]).toMatchObject({ kind: "incident-resolved", message: "after 18 min", level: "ok" });
  });

  it("indexes every fact row, folded ones included", () => {
    expect(d.factIndex["kuma.version"]!.display).toBe("2.5.5");
    expect(d.factIndex["forgejo.healthzOk"]!.display).toBe("yes");
    expect(d.factGroups.find((g) => g.id === "forgejo")!.rows.map((r) => r.key)).not.toContain("healthzOk");
  });
});

describe("freshness and verdict", () => {
  it("empty model: no data yet, every configured source empty, no services", () => {
    const v = edited((i) => {
      i.model = {
        site: "demo",
        generatedAt: NOW,
        sources: [],
        services: [],
        recentHeartbeats: [],
        openIncidents: [],
        recentIncidents: [],
        facts: [],
      };
      i.history = [];
    });
    expect(v.verdict).toEqual({ state: "empty", label: "No data yet", down: 0, degraded: 0 });
    expect(v.freshness).toEqual({
      state: "empty",
      ageS: null,
      stalestSourceId: null,
      perSource: [
        {
          id: "kuma:watch-1",
          kind: "kuma",
          expectedIntervalS: 60,
          lastSeenAt: null,
          ageS: null,
          freshness: "empty",
        },
        {
          id: "facts:app-1",
          kind: "facts",
          expectedIntervalS: 900,
          lastSeenAt: null,
          ageS: null,
          freshness: "empty",
        },
        {
          id: "probe:cf",
          kind: "probe",
          expectedIntervalS: 60,
          lastSeenAt: null,
          ageS: null,
          freshness: "empty",
        },
      ],
    });
    expect(v.generatedAt).toBe(NOW);
    expect(
      v.sections.every((s) => s.services.length === 0 && s.state === "unknown" && s.exitCode === 0),
    ).toBe(true);
    expect(v.summary).toEqual({
      total: 0,
      up: 0,
      down: 0,
      degraded: 0,
      maintenance: 0,
      other: 0,
      avgLatencyMs: null,
      uptime24h: null,
      uptime30d: null,
      healthScore: null,
    });
    expect(v.factGroups).toEqual([]);
    expect(v.factIndex).toEqual({});
    expect(v.activity).toEqual([]);
    expect(v.topology!.fence).toBeNull();
    expect(v.topology!.nodes.every((n) => n.state === "unknown")).toBe(true);
    expect(v.topology!.edges.every((e) => !e.live && e.detail === null)).toBe(true);
  });

  it("a configured source never seen stays empty in perSource and does not make the site stale", () => {
    const v = edited((i) => {
      i.model.sources = i.model.sources.filter((s) => s.id !== "facts:app-1");
    });
    expect(v.freshness.perSource[1]).toMatchObject({ id: "facts:app-1", freshness: "empty", ageS: null });
    expect(v.freshness).toMatchObject({ state: "fresh", stalestSourceId: "kuma:watch-1", ageS: 34 });
    expect(v.verdict.state).toBe("operational");
  });

  it("a service of a listed source the model has never seen shows stale", () => {
    const v = edited((i) => {
      i.config = withWebhook(i.config);
      i.model.services.push(service({ id: "webhook:ci", source: "webhook:ci", kind: "push" }));
    });
    const ci = svc(v, "webhook:ci");
    expect(ci.state).toBe("stale");
    expect(v.unsectioned.map((s) => s.id)).toEqual(["webhook:ci"]);
  });

  it("a listed webhook source that reports fresh keeps its services live", () => {
    const v = edited((i) => {
      i.config = withWebhook(i.config);
      i.model.sources.push({
        id: "webhook:ci",
        site: "demo",
        kind: "webhook",
        expectedIntervalS: 300,
        lastSeenAt: minutesBefore(NOW, 1),
        lastOkAt: null,
      });
      i.model.services.push(
        service({ id: "webhook:ci", source: "webhook:ci", kind: "push", status: "degraded" }),
      );
    });
    expect(svc(v, "webhook:ci").state).toBe("degraded");
    expect(v.freshness.perSource.map((p) => p.id)).toEqual([
      "kuma:watch-1",
      "facts:app-1",
      "probe:cf",
      "webhook:ci",
    ]);
    expect(v.verdict).toMatchObject({ state: "degraded", label: "1 service degraded", degraded: 1 });
  });

  it("aging data keeps the real status", () => {
    // 3 minutes after the last kuma report: past 2x its 60 s interval, not yet past 5x.
    const v = edited((i) => {
      i.now = "2026-09-28T00:00:26Z";
    });
    expect(v.freshness.perSource[0]!.freshness).toBe("aging");
    expect(v.freshness.state).toBe("aging");
    expect(svc(v, "kuma:1").state).toBe("up");
    expect(v.verdict.state).toBe("operational");
  });

  it("a down service on fresh data outranks another source going stale", () => {
    const v = edited((i) => {
      i.now = "2026-09-28T00:02:00Z";
      i.model.sources.find((s) => s.id === "kuma:watch-1")!.lastSeenAt = "2026-09-28T00:01:30Z";
      i.model.sources.find((s) => s.id === "facts:app-1")!.lastSeenAt = "2026-09-27T22:00:00Z";
    }, "incident");
    expect(v.freshness.state).toBe("stale");
    expect(v.verdict.state).toBe("outage");
  });

  it("stale data never counts as down", () => {
    const v = edited((i) => {
      i.now = "2026-09-28T00:30:00Z";
    }, "incident");
    expect(svc(v, "kuma:5")).toMatchObject({ status: "down", state: "stale" });
    expect(v.verdict).toMatchObject({ state: "stale", down: 0 });
  });

  it("clock skew: data from the future reads as age 0, not negative", () => {
    const v = edited((i) => {
      i.now = "2026-09-27T23:20:00Z";
    });
    expect(v.freshness.perSource.map((p) => [p.ageS, p.freshness])).toEqual([
      [0, "fresh"],
      [0, "fresh"],
      [null, "empty"],
    ]);
    expect(v.factIndex["backup.lastAt"]!.display).toBe("just now");
    expect(v.incidents.recent.every((i) => i.durationS >= 0)).toBe(true);
    const open = edited((i) => {
      i.now = "2026-09-27T23:50:00Z";
    }, "incident");
    expect(open.incidents.open[0]!.durationS).toBe(0);
  });

  it("accepts now as a Date, epoch milliseconds or a string, and prints it at whole seconds", () => {
    const at = (now: ViewInput["now"]) => edited((i) => void (i.now = now)).now;
    expect(at(new Date(NOW))).toBe(NOW);
    expect(at(Date.parse(NOW) + 400)).toBe(NOW);
    expect(at(NOW)).toBe(NOW);
  });
});

describe("maintenance verdict", () => {
  /** `input` under one window (active at every fixture's `now`) covering `services`, or the whole site. */
  const inWindow = (input: ViewInput, services: string[]): ViewInput => ({
    ...input,
    config: { ...input.config, maintenance: [{ ...SITE_WIDE_WINDOW, services }] },
  });
  const ids = (input: ViewInput) => input.model.services.map((s) => s.id);

  it("is maintenance when every service is in a window and none is up", () => {
    const v = view(fixtureInput("maintenance"));
    expect(v.summary).toMatchObject({ up: 0, down: 0, degraded: 0, maintenance: v.summary.total });
    expect(v.verdict).toEqual({
      state: "maintenance",
      label: `${v.summary.total} services under maintenance`,
      down: 0,
      degraded: 0,
    });
  });

  it("names one service in the singular", () => {
    const input = fixtureInput("default");
    const one = ids(input)[0]!;
    input.model.services = input.model.services.filter((s) => s.id === one);
    expect(view(inWindow(input, [])).verdict.label).toBe("1 service under maintenance");
  });

  it("stays operational while some services are up (partial maintenance)", () => {
    const input = fixtureInput("default");
    const v = view(inWindow(input, [ids(input)[0]!]));
    expect(v.summary.maintenance).toBe(1);
    expect(v.summary.up).toBeGreaterThan(0);
    expect(v.verdict).toMatchObject({ state: "operational", label: "All systems operational" });
  });

  it("is an outage when a service outside the window is down", () => {
    const input = fixtureInput("incident");
    const v = view(
      inWindow(
        input,
        ids(input).filter((id) => id !== "kuma:5"),
      ),
    );
    expect(v.summary).toMatchObject({ up: 0, down: 1 });
    expect(v.verdict).toMatchObject({ state: "outage", label: "1 service down", down: 1 });
  });

  it("is degraded when a service outside the window is degraded", () => {
    const input = fixtureInput("default");
    const [slow, ...rest] = ids(input);
    input.model.services.find((s) => s.id === slow)!.status = "degraded";
    const v = view(inWindow(input, rest));
    expect(v.summary).toMatchObject({ up: 0, degraded: 1 });
    expect(v.verdict).toMatchObject({ state: "degraded", label: "1 service degraded", degraded: 1 });
  });

  it("hides a stale source under a site-wide window, and only then", () => {
    const input = fixtureInput("stale");
    expect(view(input).verdict.state).toBe("stale");

    const site = view(inWindow(input, []));
    expect(site.freshness).toMatchObject({ state: "stale", quietForMaintenance: true });
    expect(site.verdict.state).toBe("maintenance");

    // Every service listed one by one is not a site-wide window: the stale source still shows.
    const listed = view(inWindow(input, ids(input)));
    expect(listed.summary.up).toBe(0);
    expect(listed.freshness.quietForMaintenance).toBeUndefined();
    expect(listed.verdict.state).toBe("stale");
  });
});

describe("services", () => {
  it("maintenance keeps exit 0 and counts apart", () => {
    const v = edited((i) => {
      i.model.services.find((s) => s.id === "kuma:3")!.status = "maintenance";
    });
    expect(svc(v, "kuma:3").state).toBe("maintenance");
    expect(v.sections.find((s) => s.id === "database")).toMatchObject({ state: "maintenance", exitCode: 0 });
    expect(v.summary).toMatchObject({ up: 7, maintenance: 1, other: 0 });
    expect(v.verdict.state).toBe("operational");
  });

  it("pending and paused count as other and fail the section's exit code", () => {
    const v = edited((i) => {
      i.model.services.find((s) => s.id === "kuma:8")!.status = "pending";
      i.model.services.find((s) => s.id === "kuma:9")!.status = "paused";
    });
    expect(v.summary).toMatchObject({ up: 6, other: 2 });
    expect(v.sections.find((s) => s.id === "workers")).toMatchObject({ state: "pending", exitCode: 1 });
  });

  it("leaves out a section none of whose services is in the model; the others keep what exists", () => {
    const v = edited((i) => {
      const gone = new Set(["kuma:3", "kuma:5", "kuma:4"]);
      i.model.services = i.model.services.filter((s) => !gone.has(s.id));
      i.config = {
        ...i.config,
        sections: [...i.config.sections, { id: "empty", title: "Empty", services: [] }],
      };
    });
    expect(v.sections.map((s) => s.id)).toEqual(["web", "access", "workers"]);
    expect(v.sections.find((s) => s.id === "access")!.services.map((s) => s.id)).toEqual(["kuma:6"]);
    for (const s of v.sections) expect(s.services.length).toBeGreaterThan(0);
    expect(v.unsectioned.map((s) => s.id)).toEqual(edited(() => {}).unsectioned.map((s) => s.id));
  });

  it("an empty model leaves no section at all", () => {
    const v = edited((i) => {
      i.model.services = [];
    });
    expect(v.sections).toEqual([]);
    expect(v.unsectioned).toEqual([]);
  });

  it("missing history: 90 no-data cells ending today", () => {
    const v = edited((i) => {
      i.history = [];
    });
    const x = svc(v, "kuma:1");
    expect(x.beats90d).toHaveLength(90);
    expect(x.beatsText).toBe(".".repeat(90));
    expect(x.beats90d.at(-1)!.day).toBe("2026-09-27");
    expect(x.beats90d.every((c) => c.worst === null && c.uptime === null && c.minutesDown === 0)).toBe(true);
  });

  it("beat characters per worst state, and days outside the window are ignored", () => {
    const v = edited((i) => {
      i.history = [
        {
          serviceId: "kuma:1",
          days: [
            { day: "2026-01-01", worst: "down", uptime: 0.5, minutesDown: 720 },
            { day: "2026-09-21", worst: "pending", uptime: 1, minutesDown: 0 },
            { day: "2026-09-22", worst: "paused", uptime: 1, minutesDown: 0 },
            { day: "2026-09-23", worst: "unknown", uptime: 1, minutesDown: 0 },
            { day: "2026-09-24", worst: "maintenance", uptime: 1, minutesDown: 0 },
            { day: "2026-09-25", worst: "degraded", uptime: 0.99, minutesDown: 0 },
            { day: "2026-09-26", worst: "down", uptime: 0.9, minutesDown: 144 },
            { day: "2026-09-27", worst: "up", uptime: 1, minutesDown: 0 },
          ],
        },
      ];
    });
    expect(svc(v, "kuma:1").beatsText).toBe(`${".".repeat(83)}~..=~x+`);
  });

  it("cert levels: warn, crit, invalid and expired", () => {
    const at = (validTo: string, valid = true) =>
      svc(
        edited((i) => {
          i.model.services.find((s) => s.id === "kuma:1")!.cert = {
            valid,
            cn: "example.com",
            issuer: "Example CA",
            validTo,
            daysRemaining: 99,
          };
        }),
        "kuma:1",
      );
    const warn = at("2026-10-08T00:00:00Z");
    expect(warn.cert).toMatchObject({ daysRemaining: 10, level: "warn" });
    expect(warn.health.reasons).toContain("cert expires in 10 days");
    expect(warn.health.level).toBe("warn");
    const crit = at("2026-10-03T12:00:00Z");
    expect(crit.cert).toMatchObject({ daysRemaining: 5, level: "crit" });
    expect(crit.health.level).toBe("crit");
    const invalid = at("2027-01-01T00:00:00Z", false);
    expect(invalid.cert!.level).toBe("crit");
    expect(invalid.health.reasons).toContain("cert invalid");
    const expired = at("2026-09-20T00:00:00Z");
    expect(expired.cert).toMatchObject({ daysRemaining: -8, level: "crit" });
    expect(expired.health.reasons).toContain("cert expired");
    // Edges: exactly certWarnDays and certCritDays left.
    expect(at("2026-10-12T00:00:00Z").cert).toMatchObject({ daysRemaining: 14, level: "warn" });
    expect(at("2026-10-05T00:00:00Z").cert).toMatchObject({ daysRemaining: 7, level: "crit" });
    expect(at("2026-10-13T00:00:00Z").cert).toMatchObject({ daysRemaining: 15, level: "ok" });
  });

  it("health: weights from config, renormalized over the parts a service has", () => {
    const input = fixtureInput("default");
    input.model.services = [
      service({ id: "kuma:1", uptime30d: 0.99, latencyMs: 150, avgLatencyMs: 100 }),
      service({ id: "kuma:2", uptime30d: null, uptime24h: null, latencyMs: null, avgLatencyMs: null }),
    ];
    input.config = { ...config, health: { uptime: 1, latency: 1, cert: 0 } };
    // Nothing stored to derive from either: kuma:2 has no history and no beats.
    input.history = input.history.filter((h) => h.serviceId !== "kuma:2");
    input.model.recentHeartbeats = input.model.recentHeartbeats.filter((b) => b.serviceId !== "kuma:2");
    const v = view(input);
    // uptime 80, latency 50, equal weights.
    expect(svc(v, "kuma:1").health).toEqual({
      score: 65,
      level: "crit",
      reasons: ["uptime 30d 99.00%", "latency 150 ms vs 100 ms avg"],
    });
    expect(svc(v, "kuma:2").health).toEqual({ score: null, level: "ok", reasons: [] });
    expect(v.summary.healthScore).toBe(65);
  });

  it("display names from config override the source's name", () => {
    const v = edited((i) => {
      i.config = { ...config, displayNames: { "kuma:1": "Forgejo API" } };
    });
    expect(svc(v, "kuma:1").name).toBe("Forgejo API");
  });

  it("keeps at most 48 recent beats per service", () => {
    const v = edited((i) => {
      i.model.recentHeartbeats = Array.from({ length: 60 }, (_, n) =>
        beat("kuma:1", minutesBefore(NOW, n + 1), { latencyMs: n % 3 === 0 ? null : n }),
      );
    });
    const x = svc(v, "kuma:1");
    expect(x.recent).toHaveLength(48);
    expect(x.recent[0]!.ts).toBe("2026-09-27T23:57:00Z");
    expect(x.spark).toHaveLength(32);
    expect(x.spark.at(-1)).toBe(1);
  });
});

describe("activity", () => {
  it("lists status transitions, newest first, with levels per status", () => {
    const v = edited((i) => {
      i.model.recentHeartbeats.push(
        beat("kuma:3", "2026-09-27T23:30:00Z", { status: "pending", important: true, message: "slow" }),
        beat("kuma:3", "2026-09-27T23:31:00Z", { status: "up", important: true }),
        beat("kuma:4", "2026-09-27T23:32:00Z", { status: "maintenance", important: true }),
      );
    });
    expect(v.activity.slice(0, 3).map((a) => [a.ts, a.kind, a.level, a.title, a.message])).toEqual([
      ["2026-09-27T23:32:00Z", "status", "info", "Primary SSH is in maintenance", null],
      ["2026-09-27T23:31:00Z", "status", "ok", "Primary Postgres is up", null],
      ["2026-09-27T23:30:00Z", "status", "warn", "Primary Postgres is pending", "slow"],
    ]);
  });

  it("stale incidents appear as source rows, and an open one replaces the derived stale row", () => {
    const staleIncident: Incident = {
      id: "kuma:watch-1:2026-09-28T00:02:26Z",
      site: "demo",
      kind: "stale",
      serviceId: null,
      sourceId: "kuma:watch-1",
      startedAt: "2026-09-28T00:02:26Z",
      endedAt: null,
      title: "kuma:watch-1 stopped reporting",
      notes: null,
    };
    const v = edited((i) => {
      i.model.openIncidents = [staleIncident];
    }, "stale");
    const rows = v.activity.filter((a) => a.kind === "source");
    expect(rows).toEqual([
      {
        id: `open:${staleIncident.id}`,
        ts: staleIncident.startedAt,
        level: "warn",
        kind: "source",
        serviceId: null,
        sourceId: "kuma:watch-1",
        title: "kuma:watch-1 stopped reporting",
        message: null,
      },
    ]);
    expect(v.incidents.open[0]).toMatchObject({ subject: "kuma:watch-1", durationS: 540 });
    expect(v.incidents.open[0]!.steps).toEqual([
      { ts: staleIncident.startedAt, label: "Stopped reporting", level: "warn" },
    ]);

    const recovered = edited((i) => {
      i.model.recentIncidents.push({ ...staleIncident, endedAt: "2026-09-28T00:05:00Z" });
    });
    expect(recovered.activity.find((a) => a.id === `resolved:${staleIncident.id}`)).toMatchObject({
      kind: "source",
      level: "ok",
      title: "kuma:watch-1 reporting again",
      message: "after 2 min",
    });
  });

  it("incident steps include transitions inside the incident; overlapping model lists are deduplicated", () => {
    const v = edited((i) => {
      const open = i.model.openIncidents[0]!;
      i.model.recentIncidents.push(open);
      i.model.recentHeartbeats.push(
        beat("kuma:5", "2026-09-27T23:54:30Z", { status: "pending", important: true, latencyMs: null }),
      );
    }, "incident");
    expect(v.incidents.open).toHaveLength(1);
    expect(v.incidents.recent.map((x) => x.endedAt === null)).not.toContain(true);
    expect(v.incidents.open[0]!.steps.map((s) => [s.label, s.level])).toEqual([
      ["Detected", "crit"],
      ["Replica Postgres is pending", "warn"],
    ]);
    expect(v.activity.filter((a) => a.kind === "incident-open" && a.serviceId === "kuma:5")).toHaveLength(3);
  });

  it("keeps at most 40 items", () => {
    const v = edited((i) => {
      i.model.recentHeartbeats = Array.from({ length: 60 }, (_, n) =>
        beat("kuma:1", minutesBefore(NOW, n + 1), { status: n % 2 ? "up" : "down", important: true }),
      );
    });
    expect(v.activity).toHaveLength(40);
    expect(v.activity[0]!.ts).toBe("2026-09-27T23:57:00Z");
  });
});

describe("facts and topology", () => {
  it("an unknown fact group renders generically after the known groups", () => {
    const v = edited((i) => {
      i.model.facts.push(
        fact("tailnet", "onlineDevices", { type: "number", value: 6 }),
        fact("tailnet", "lastCheck", { type: "timestamp", value: "2026-09-27T23:48:00Z" }),
        fact("tailnet", "exit_node", { type: "boolean", value: false }, { severity: "warn" }),
      );
    });
    expect(v.factGroups.map((g) => g.id)).toEqual([
      "forgejo",
      "replication",
      "fence",
      "backup",
      "runners",
      "disk",
      "watchdog",
      "kuma",
      "tailnet",
    ]);
    const g = v.factGroups.at(-1)!;
    expect(g).toMatchObject({ title: "Tailnet", level: "warn", fresh: true });
    expect(g.rows.map((r) => [r.label, r.display, r.level])).toEqual([
      ["Exit node", "no", "warn"],
      ["Last check", "10 min ago", null],
      ["Online devices", "6", null],
    ]);
  });

  it("fence other than serve is crit, and a stale reporting node shows stale in the topology", () => {
    const v = edited((i) => {
      i.now = "2026-09-28T03:00:00Z";
      for (const s of i.model.sources) s.lastSeenAt = "2026-09-28T02:59:30Z";
      i.model.facts = i.model.facts.map((f) =>
        f.group === "fence" && f.key === "decision" ? { ...f, value: { type: "string", value: "fence" } } : f,
      );
    });
    expect(v.topology!.fence).toMatchObject({ decision: "fence", level: "crit" });
    expect(v.factIndex["fence.decision"]!.level).toBe("crit");
    // The facts were observed at 23:45 with 30 minutes of freshness: past it, the nodes are stale.
    expect(v.topology!.nodes.map((n) => [n.id, n.state])).toEqual([
      ["app-1", "stale"],
      ["app-2", "stale"],
      ["watch-1", "stale"],
      // No fact covers runner-1; its Kuma monitors are fresh and up.
      ["runner-1", "up"],
    ]);
    expect(v.topology!.edges.every((e) => !e.live)).toBe(true);
  });

  it("serving node from forgejo.servingNode, watchdog from watchdog.reachable", () => {
    const v = edited((i) => {
      const set = (key: string, value: Fact["value"]) => {
        const f = i.model.facts.find((x) => `${x.group}.${x.key}` === key)!;
        f.value = value;
      };
      set("forgejo.servingNode", { type: "string", value: "app-2" });
      set("forgejo.healthzOk", { type: "boolean", value: false });
      set("watchdog.reachable", { type: "boolean", value: false });
    });
    const nodes = Object.fromEntries(v.topology!.nodes.map((n) => [n.id, [n.state, n.note]]));
    expect(nodes).toEqual({
      "app-1": ["up", "primary"],
      "app-2": ["down", "serving"],
      "watch-1": ["down", "watchdog"],
      "runner-1": ["up", "runner"],
    });
    expect(v.topology!.edges.find((e) => e.kind === "watches")!.live).toBe(false);
  });

  it("no topology in config: null, and no group is marked as drawn by it", () => {
    const v = edited((i) => {
      i.config = { ...config, topology: undefined };
    });
    expect(v.topology).toBeNull();
    expect(v.factGroups.every((g) => g.inTopology === false)).toBe(true);
  });

  it("marks the groups the topology draws (inTopology), from the profiles", () => {
    const v = edited(() => {});
    expect(v.factGroups.map((g) => [g.id, g.inTopology])).toEqual([
      ["forgejo", false],
      ["replication", true],
      ["fence", true],
      ["backup", false],
      ["runners", false],
      ["disk", false],
      ["watchdog", false],
      ["kuma", false],
    ]);
  });

  it("a stale lag keeps its last value and age on the edge and the standby's card, never a word", () => {
    const v = edited((i) => {
      const lag = i.model.facts.find((f) => f.group === "replication" && f.key === "lagSeconds")!;
      lag.freshForS = 300;
      lag.value = { type: "number", value: 4 };
    });
    expect(v.topology!.edges.find((e) => e.kind === "replication")).toMatchObject({
      live: true,
      detail: "lag 4 s, 13 min ago",
    });
    expect(v.topology!.nodes.find((n) => n.id === "app-2")!.details.at(-1)).toEqual({
      label: "wal",
      value: "lag 4 s, 13 min ago",
      state: "stale",
    });
    // The row keeps its plain value; the group is fresh, as its newest fact is.
    expect(v.factIndex["replication.lagSeconds"]!.display).toBe("4 s");
  });
});

describe("topology nodes without facts", () => {
  const runner1 = (v: ReturnType<typeof buildSiteView>) =>
    v.topology?.nodes.find((n) => n.id === "runner-1")?.state;

  it("take the worst state of the monitors that target them", () => {
    expect(runner1(buildSiteView(fixtureInput("default")))).toBe("up");
    const input = fixtureInput("default");
    input.model.services = input.model.services.map((s) =>
      s.id === "kuma:9" ? { ...s, status: "down" } : s,
    );
    expect(runner1(buildSiteView(input))).toBe("down");
  });

  it("go stale with a stale collector and stay unknown when nothing checks them", () => {
    expect(runner1(buildSiteView(fixtureInput("stale")))).toBe("stale");
    const input = fixtureInput("default");
    input.model.services = input.model.services.filter((s) => !s.targetDisplay?.startsWith("runner-1"));
    expect(runner1(buildSiteView(input))).toBe("unknown");
  });
});

describe("services whose source reports no averages or uptime", () => {
  it("derive them from stored beats and daily cells (edge probes)", () => {
    const input = fixtureInput("default");
    input.model.services = input.model.services.map((s) =>
      s.id === "kuma:1" ? { ...s, avgLatencyMs: null, uptime24h: null, uptime30d: null } : s,
    );
    const v = buildSiteView(input).sections[0]!.services.find((x) => x.id === "kuma:1")!;
    const lat = v.recent.flatMap((b) => (b.latencyMs === null ? [] : [b.latencyMs]));
    expect(v.avgLatencyMs).toBeCloseTo(lat.reduce((a, b) => a + b, 0) / lat.length);
    expect(v.uptime24h).toBe(v.beats90d.at(-1)!.uptime);
    expect(v.uptime30d).not.toBeNull();
    expect(v.health.score).not.toBeNull();
  });
});

describe("sources the config no longer lists (retired)", () => {
  /** `c` without the source `id`. */
  const without = (c: ViewInput["config"], id: string): ViewInput["config"] => ({
    ...c,
    sources: c.sources.filter((s) => s.id !== id),
  });
  const ids = (v: SiteView) => [...v.sections.flatMap((s) => s.services), ...v.unsectioned].map((s) => s.id);

  it("leave out a retired facts source's groups, highlights and headline", () => {
    const before = edited((i) => {
      i.model.facts.push(fact("acceptance", "check", { type: "string", value: "ok" }));
    });
    expect(before.factGroups.map((g) => g.id)).toContain("acceptance");
    expect(before.headline).toContain("Forgejo");
    expect(before.highlights.map((h) => h.label)).toContain("watchdog");

    const v = edited((i) => {
      i.config = without(i.config, "facts:app-1");
      i.model.facts.push(fact("acceptance", "check", { type: "string", value: "ok" }));
    });
    // Only the Kuma collector's own facts stay.
    expect(v.factGroups.map((g) => g.id)).toEqual(["kuma"]);
    expect(Object.keys(v.factIndex).every((k) => k.startsWith("kuma."))).toBe(true);
    expect(v.highlights.every((h) => h.row.group === "kuma")).toBe(true);
    expect(v.headline ?? "").not.toContain("Forgejo");
    expect(JSON.stringify(v)).not.toContain("acceptance");
    expect(v.freshness.perSource.map((p) => p.id)).toEqual(["kuma:watch-1", "probe:cf"]);
    // Services of the listed sources are untouched.
    expect(ids(v)).toEqual(ids(before));
  });

  it("leave out a retired kuma source's services from sections, unsectioned, counts and verdict", () => {
    const before = edited(() => {}, "incident");
    expect(before.verdict.state).toBe("outage");
    expect(before.incidents.open.length).toBeGreaterThan(0);

    const v = edited((i) => {
      i.config = without(i.config, "kuma:watch-1");
    }, "incident");
    expect(v.sections).toEqual([]);
    expect(v.unsectioned).toEqual([]);
    expect(v.summary).toMatchObject({ total: 0, up: 0, down: 0, degraded: 0 });
    expect(v.verdict).toMatchObject({ state: "operational", down: 0, degraded: 0 });
    expect(v.incidents.open).toEqual([]);
    expect(v.activity.every((a) => a.serviceId === null)).toBe(true);
    // Its own facts (the `kuma` group) go too; the facts collector's stay.
    expect(v.factGroups.map((g) => g.id)).not.toContain("kuma");
    expect(v.factGroups.map((g) => g.id)).toContain("forgejo");
  });

  it("leave out a retired webhook source's services and their incidents", () => {
    const ci = service({ id: "webhook:ci", source: "webhook:ci", kind: "push", status: "down" });
    const incident: Incident = {
      id: `webhook:ci:${minutesBefore(NOW, 5)}`,
      site: "demo",
      kind: "down",
      serviceId: "webhook:ci",
      sourceId: null,
      startedAt: minutesBefore(NOW, 5),
      endedAt: null,
      title: "webhook:ci down",
      notes: null,
    };
    const base = edited(() => {});
    const v = edited((i) => {
      i.model.sources.push({
        id: "webhook:ci",
        site: "demo",
        kind: "webhook",
        expectedIntervalS: 300,
        lastSeenAt: minutesBefore(NOW, 1),
        lastOkAt: null,
      });
      i.model.services.push(ci);
      i.model.recentHeartbeats.push(
        beat("webhook:ci", minutesBefore(NOW, 5), { status: "down", important: true }),
      );
      i.model.openIncidents.push(incident);
    });
    expect(ids(v)).not.toContain("webhook:ci");
    expect(v.unsectioned).toEqual([]);
    expect(v.summary).toEqual(base.summary);
    expect(v.verdict).toEqual(base.verdict);
    expect(v.incidents.open).toEqual([]);
    expect(JSON.stringify(v)).not.toContain("webhook:ci");
  });

  it("keep the monitors of an implied runner (`probe:cf`) the config does not list", () => {
    const edge = service({
      id: "probe:api-health",
      source: "probe:cf",
      externalId: "api-health",
      name: "API health (edge)",
    });
    const v = edited((i) => {
      i.config = without(i.config, "probe:cf");
      i.model.sources.push({
        id: "probe:cf",
        site: "demo",
        kind: "probe",
        expectedIntervalS: 60,
        lastSeenAt: minutesBefore(NOW, 1),
        lastOkAt: null,
      });
      i.model.services.push(edge);
    });
    expect(ids(v)).toContain("probe:api-health");
    expect(svc(v, "probe:api-health").state).toBe("up");
  });
});
