import { describe, expect, it } from "vitest";
import { type Heartbeat, Incident, type Service, type ServiceStatus, type Source } from "@/shared/model";
import type { ModelDelta } from "@/shared/schemas";
import {
  type DownInput,
  deriveDeltaIncidents,
  deriveDownIncidents,
  deriveIncidents,
  deriveStaleIncidents,
  isOutdatedDelta,
  RETIRED_NOTE,
  statusEffect,
} from "@/worker/engine/incidents";

const site = "demo";
const T = (hms: string) => `2026-09-27T${hms}Z`;

const svc = (externalId: string, status: ServiceStatus, name = `Service ${externalId}`): Service => ({
  id: `kuma:${externalId}`,
  site,
  source: "kuma:watch-1",
  externalId,
  name,
  kind: "http",
  targetDisplay: "example.com/health",
  intervalS: 60,
  status,
  latencyMs: null,
  avgLatencyMs: null,
  uptime24h: null,
  uptime30d: null,
});

const hb = (serviceId: string, ts: string, status: ServiceStatus, important = true): Heartbeat => ({
  site,
  serviceId,
  ts,
  status,
  latencyMs: null,
  message: null,
  important,
});

const down = (serviceId: string, startedAt: string, endedAt: string | null = null, name = "Service 5") =>
  Incident.parse({
    id: `${serviceId}:${startedAt}`,
    site,
    kind: "down",
    serviceId,
    sourceId: null,
    startedAt,
    endedAt,
    title: `${name} down`,
    notes: null,
  });

const input = (over: Partial<DownInput>): DownInput => ({
  site,
  at: T("12:00:00"),
  before: [],
  after: [],
  heartbeats: [],
  incidents: [],
  ...over,
});

describe("statusEffect", () => {
  it("only down opens; up and degraded close; the rest are neutral", () => {
    expect(statusEffect("down")).toBe("open");
    expect(statusEffect("up")).toBe("close");
    expect(statusEffect("degraded")).toBe("close");
    for (const s of ["pending", "maintenance", "paused", "unknown"] as const)
      expect(statusEffect(s)).toBe("none");
  });
});

describe("deriveDownIncidents", () => {
  it("opens one incident at the first down beat, with a valid model shape", () => {
    const r = deriveDownIncidents(
      input({
        after: [svc("5", "down")],
        heartbeats: [hb("kuma:5", T("11:53:00"), "down"), hb("kuma:5", T("11:52:00"), "down")],
      }),
    );
    expect(r.opened).toEqual([down("kuma:5", T("11:52:00"))]);
    expect(r.resolved).toEqual([]);
    for (const i of r.opened) Incident.parse(i);
  });

  it("is idempotent when the incident is already open", () => {
    const r = deriveDownIncidents(
      input({
        after: [svc("5", "down")],
        heartbeats: [hb("kuma:5", T("11:52:00"), "down")],
        incidents: [down("kuma:5", T("11:52:00"))],
      }),
    );
    expect(r).toEqual({ opened: [], resolved: [] });
  });

  it("resolves the open incident at the up beat", () => {
    const open = down("kuma:5", T("11:52:00"));
    const r = deriveDownIncidents(
      input({ after: [svc("5", "up")], heartbeats: [hb("kuma:5", T("11:58:00"), "up")], incidents: [open] }),
    );
    expect(r).toEqual({ opened: [], resolved: [{ ...open, endedAt: T("11:58:00") }] });
  });

  it("maintenance, paused and pending neither open nor close", () => {
    for (const status of ["maintenance", "paused", "pending", "unknown"] as const) {
      expect(
        deriveDownIncidents(
          input({ after: [svc("5", status)], heartbeats: [hb("kuma:5", T("11:52:00"), status)] }),
        ),
      ).toEqual({ opened: [], resolved: [] });
      const open = down("kuma:5", T("11:00:00"));
      expect(
        deriveDownIncidents(
          input({
            after: [svc("5", status)],
            heartbeats: [hb("kuma:5", T("11:52:00"), status)],
            incidents: [open],
          }),
        ),
      ).toEqual({ opened: [], resolved: [] });
    }
  });

  it("degraded closes a down incident", () => {
    const open = down("kuma:5", T("11:00:00"));
    const r = deriveDownIncidents(
      input({
        after: [svc("5", "degraded")],
        heartbeats: [hb("kuma:5", T("11:10:00"), "degraded")],
        incidents: [open],
      }),
    );
    expect(r.resolved).toEqual([{ ...open, endedAt: T("11:10:00") }]);
  });

  it("reports an outage that opened and closed within one input in both lists", () => {
    const r = deriveDownIncidents(
      input({
        after: [svc("5", "up")],
        heartbeats: [
          hb("kuma:5", T("11:50:00"), "up"),
          hb("kuma:5", T("11:52:00"), "down"),
          hb("kuma:5", T("11:55:00"), "maintenance"),
          hb("kuma:5", T("11:57:00"), "up"),
        ],
      }),
    );
    const closed = down("kuma:5", T("11:52:00"), T("11:57:00"));
    expect(r).toEqual({ opened: [closed], resolved: [closed] });
  });

  it("opens a second incident after a recovery within the same input", () => {
    const r = deriveDownIncidents(
      input({
        after: [svc("5", "down")],
        heartbeats: [
          hb("kuma:5", T("11:52:00"), "down"),
          hb("kuma:5", T("11:54:00"), "up"),
          hb("kuma:5", T("11:56:00"), "down"),
        ],
      }),
    );
    expect(r.opened.map((i) => [i.id, i.endedAt])).toEqual([
      ["kuma:5:2026-09-27T11:52:00Z", T("11:54:00")],
      ["kuma:5:2026-09-27T11:56:00Z", null],
    ]);
    expect(r.resolved.map((i) => i.id)).toEqual(["kuma:5:2026-09-27T11:52:00Z"]);
  });

  it("ignores replayed beats at or before the end of the latest closed incident", () => {
    const closed = down("kuma:5", T("11:52:00"), T("11:58:00"));
    const r = deriveDownIncidents(
      input({
        at: T("11:58:00"),
        after: [svc("5", "down")],
        heartbeats: [hb("kuma:5", T("11:52:00"), "down"), hb("kuma:5", T("11:57:00"), "down")],
        incidents: [closed],
      }),
    );
    expect(r).toEqual({ opened: [], resolved: [] });
  });

  it("opens from the service row alone at `at` when no beat carries the change", () => {
    const r = deriveDownIncidents(
      input({ at: T("12:00:00"), before: [svc("5", "up")], after: [svc("5", "down")] }),
    );
    expect(r.opened).toEqual([down("kuma:5", T("12:00:00"))]);
  });

  it("closes from the service row alone, but never before the incident started", () => {
    const open = down("kuma:5", T("11:00:00"));
    expect(
      deriveDownIncidents(input({ at: T("12:00:00"), after: [svc("5", "up")], incidents: [open] })).resolved,
    ).toEqual([{ ...open, endedAt: T("12:00:00") }]);
    expect(
      deriveDownIncidents(input({ at: T("10:00:00"), after: [svc("5", "up")], incidents: [open] })).resolved,
    ).toEqual([]);
  });

  it("does nothing for an up beat without an open incident", () => {
    expect(
      deriveDownIncidents(
        input({ after: [svc("5", "up")], heartbeats: [hb("kuma:5", T("11:00:00"), "up")] }),
      ),
    ).toEqual({ opened: [], resolved: [] });
  });

  it("canonicalizes timestamps so ids match however the producer spells them", () => {
    const r = deriveDownIncidents(input({ heartbeats: [hb("kuma:5", "2026-09-27T11:52:00.000Z", "down")] }));
    expect(r.opened[0]?.id).toBe("kuma:5:2026-09-27T11:52:00Z");
    expect(r.opened[0]?.startedAt).toBe(T("11:52:00"));
  });

  it("names the incident from the service rows, else the id", () => {
    const a = deriveDownIncidents(
      input({
        before: [svc("5", "up", "Replica Postgres")],
        heartbeats: [hb("kuma:5", T("11:52:00"), "down")],
      }),
    );
    expect(a.opened[0]?.title).toBe("Replica Postgres down");
    const b = deriveDownIncidents(input({ heartbeats: [hb("kuma:7", T("11:52:00"), "down")] }));
    expect(b.opened[0]?.title).toBe("kuma:7 down");
  });

  it("handles services independently", () => {
    const r = deriveDownIncidents(
      input({
        after: [svc("1", "down"), svc("2", "up"), svc("3", "down")],
        heartbeats: [hb("kuma:1", T("11:00:00"), "down"), hb("kuma:3", T("11:30:00"), "down")],
        incidents: [down("kuma:2", T("10:00:00"))],
      }),
    );
    expect(r.opened.map((i) => i.id).sort()).toEqual([
      "kuma:1:2026-09-27T11:00:00Z",
      "kuma:3:2026-09-27T11:30:00Z",
    ]);
    expect(r.resolved.map((i) => i.serviceId)).toEqual(["kuma:2"]);
  });
  // Cases carried over from the ingest stream's former `deriveIncidents` (src/worker/ingest/incidents.ts).
  it("opens on down, resolves on up across two inputs, ignores maintenance", () => {
    const tr = deriveDownIncidents(
      input({
        before: [svc("5", "up", "Replica Postgres")],
        heartbeats: [
          hb("kuma:5", T("23:52:00"), "down"),
          hb("kuma:5", T("23:53:00"), "down"),
          hb("kuma:6", T("23:52:00"), "maintenance"),
        ],
      }),
    );
    expect(tr.opened.map((i) => i.id)).toEqual(["kuma:5:2026-09-27T23:52:00Z"]);
    expect(tr.opened[0]!.title).toBe("Replica Postgres down");

    const later = deriveDownIncidents(
      input({ at: T("23:58:00"), heartbeats: [hb("kuma:5", T("23:58:00"), "up")], incidents: tr.opened }),
    );
    expect(later.opened).toEqual([]);
    expect(later.resolved).toEqual([{ ...tr.opened[0], endedAt: T("23:58:00") }]);
  });

  it("an unimportant down beat still opens: every beat carries the status, not only transitions", () => {
    const r = deriveDownIncidents(input({ heartbeats: [hb("kuma:7", T("23:52:00"), "down", false)] }));
    expect(r.opened.map((i) => i.id)).toEqual(["kuma:7:2026-09-27T23:52:00Z"]);
  });

  it("does not resolve with an up beat older than the incident", () => {
    const open = down("kuma:5", T("23:52:00"));
    expect(
      deriveDownIncidents(input({ heartbeats: [hb("kuma:5", T("23:40:00"), "up")], incidents: [open] })),
    ).toEqual({ opened: [], resolved: [] });
  });
});

describe("deriveDeltaIncidents", () => {
  const source = (lastSeenAt: string | null): Source => ({
    id: "kuma:watch-1",
    site,
    kind: "kuma",
    expectedIntervalS: 60,
    lastSeenAt,
    lastOkAt: lastSeenAt,
  });
  const delta = (generatedAt: string, beats: Heartbeat[], services: Service[] = []): ModelDelta => ({
    site,
    generatedAt,
    source: { sourceId: "kuma:watch-1", seenAt: generatedAt, ok: true, error: null },
    services,
    heartbeats: beats,
    facts: [],
  });

  it("derives down incidents from a current delta", () => {
    const d = delta(T("12:00:00"), [hb("kuma:5", T("11:59:00"), "down")], [svc("5", "down")]);
    const r = deriveDeltaIncidents({
      delta: d,
      before: [],
      incidents: [],
      previous: source(T("11:59:00")),
      touched: source(T("12:00:00")),
    });
    expect(r.opened.map((i) => i.id)).toEqual(["kuma:5:2026-09-27T11:59:00Z"]);
  });

  it("treats a delta older than the source's last accepted one as history: nothing opens or closes", () => {
    const old = delta(T("11:50:00"), [hb("kuma:5", T("11:40:00"), "down")], [svc("5", "down")]);
    expect(isOutdatedDelta(old, source(T("11:57:26")))).toBe(true);
    expect(isOutdatedDelta(old, source(null))).toBe(false);
    expect(isOutdatedDelta(old, null)).toBe(false);
    const r = deriveDeltaIncidents({
      delta: old,
      before: [svc("5", "up")],
      incidents: [],
      previous: source(T("11:57:26")),
      touched: source(T("11:57:26")),
    });
    expect(r).toEqual({ opened: [], resolved: [] });
  });

  it("closes the source's stale incident when the delta makes it fresh again", () => {
    const stale = Incident.parse({
      id: "kuma:watch-1:2026-09-27T10:05:00Z",
      site,
      kind: "stale",
      serviceId: null,
      sourceId: "kuma:watch-1",
      startedAt: T("10:05:00"),
      endedAt: null,
      title: "Source kuma:watch-1 stale",
      notes: null,
    });
    const r = deriveDeltaIncidents({
      delta: delta(T("12:00:00"), []),
      before: [],
      incidents: [stale],
      previous: source(T("10:00:00")),
      touched: source(T("12:00:00")),
    });
    expect(r).toEqual({ opened: [], resolved: [{ ...stale, endedAt: T("12:00:00") }] });
  });
});

describe("deriveStaleIncidents", () => {
  const src = (lastSeenAt: string | null, expectedIntervalS = 60): Source => ({
    id: "kuma:watch-1",
    site,
    kind: "kuma",
    expectedIntervalS,
    lastSeenAt,
    lastOkAt: lastSeenAt,
  });
  const staleAt = (startedAt: string, endedAt: string | null = null) =>
    Incident.parse({
      id: `kuma:watch-1:${startedAt}`,
      site,
      kind: "stale",
      serviceId: null,
      sourceId: "kuma:watch-1",
      startedAt,
      endedAt,
      title: "Source kuma:watch-1 stale",
      notes: null,
    });

  it("opens when the source crosses 5x its interval, starting at the threshold", () => {
    const r = deriveStaleIncidents({
      site,
      sources: [src(T("10:00:00"))],
      incidents: [],
      now: T("10:06:00"),
    });
    expect(r).toEqual({ opened: [staleAt(T("10:05:00"))], resolved: [] });
  });

  it("does nothing while fresh or aging, or for a source never seen", () => {
    for (const now of [T("10:01:00"), T("10:04:00"), T("10:05:00")]) {
      expect(deriveStaleIncidents({ site, sources: [src(T("10:00:00"))], incidents: [], now })).toEqual({
        opened: [],
        resolved: [],
      });
    }
    expect(deriveStaleIncidents({ site, sources: [src(null)], incidents: [], now: T("23:00:00") })).toEqual({
      opened: [],
      resolved: [],
    });
  });

  it("is idempotent while open, and never reopens a closed incident with the same id", () => {
    const input = { site, sources: [src(T("10:00:00"))], now: T("11:00:00") };
    expect(deriveStaleIncidents({ ...input, incidents: [staleAt(T("10:05:00"))] }).opened).toEqual([]);
    expect(
      deriveStaleIncidents({ ...input, incidents: [staleAt(T("10:05:00"), T("10:20:00"))] }).opened,
    ).toEqual([]);
  });

  it("resolves when the source is fresh or aging again, at its last seen time", () => {
    const open = staleAt(T("10:05:00"));
    const fresh = deriveStaleIncidents({
      site,
      sources: [src(T("10:30:00"))],
      incidents: [open],
      now: T("10:30:10"),
    });
    expect(fresh.resolved).toEqual([{ ...open, endedAt: T("10:30:00") }]);
    const aging = deriveStaleIncidents({
      site,
      sources: [src(T("10:30:00"))],
      incidents: [open],
      now: T("10:33:00"),
    });
    expect(aging.resolved).toHaveLength(1);
  });
});

describe("deriveStaleIncidents with watched sources", () => {
  const src = (id: string, lastSeenAt: string): Source => ({
    id,
    site,
    kind: "probe",
    expectedIntervalS: 60,
    lastSeenAt,
    lastOkAt: lastSeenAt,
  });
  const openStale = (sourceId: string, startedAt: string) =>
    Incident.parse({
      id: `${sourceId}:${startedAt}`,
      site,
      kind: "stale",
      serviceId: null,
      sourceId,
      startedAt,
      endedAt: null,
      title: `Source ${sourceId} stale`,
      notes: null,
    });

  it("never opens for a source it does not watch", () => {
    const r = deriveStaleIncidents({
      site,
      sources: [src("probe:office-1", T("10:00:00")), src("probe:cf", T("10:00:00"))],
      incidents: [],
      now: T("10:06:00"),
      watched: new Set(["probe:cf"]),
    });
    expect(r.opened.map((i) => i.sourceId)).toEqual(["probe:cf"]);
  });

  it("resolves an unwatched source's open incident at now, noted as retired", () => {
    const open = openStale("probe:office-1", T("10:05:00"));
    const r = deriveStaleIncidents({
      site,
      sources: [src("probe:office-1", T("10:00:00"))],
      incidents: [open],
      now: T("11:00:00"),
      watched: new Set(),
    });
    expect(r).toEqual({ opened: [], resolved: [{ ...open, endedAt: T("11:00:00"), notes: RETIRED_NOTE }] });
  });

  it("watches everything without a set, as before", () => {
    const r = deriveStaleIncidents({
      site,
      sources: [src("probe:office-1", T("10:00:00"))],
      incidents: [],
      now: T("10:06:00"),
    });
    expect(r.opened).toHaveLength(1);
  });
});

describe("deriveIncidents", () => {
  it("combines both kinds", () => {
    const r = deriveIncidents(input({ heartbeats: [hb("kuma:5", T("11:52:00"), "down")] }), {
      site,
      sources: [
        {
          id: "facts:app-1",
          site,
          kind: "facts",
          expectedIntervalS: 900,
          lastSeenAt: T("08:00:00"),
          lastOkAt: null,
        },
      ],
      incidents: [],
      now: T("12:00:00"),
    });
    expect(r.opened.map((i) => i.kind)).toEqual(["down", "stale"]);
  });
});
