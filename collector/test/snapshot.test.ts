import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { parseHostAliases } from "../src/address";
import { BeatBuffer } from "../src/buffer";
import { wireBuffer } from "../src/collector";
import { findForbiddenLiterals, KumaSnapshot } from "../src/shared";
import { buildSnapshot, guardSnapshot } from "../src/snapshot";
import {
  applyAvgPing,
  applyCertInfo,
  applyHeartbeat,
  applyHeartbeatList,
  applyImportantList,
  applyInfo,
  applyMonitorList,
  applyUptime,
  createState,
  type KumaState,
  kumaTimeToIso,
  parseCertInfo,
  toBeat,
} from "../src/state";
import { ADDR, HOST_ALIASES_JSON, importantPage, liveBeat, loginBurst, NOW } from "./fixtures/kuma-events";

/** Replays captured events through the same reducers the session wires to socket.io. */
export function replay(state: KumaState, events: [string, ...unknown[]][]): void {
  for (const [name, ...a] of events) {
    if (name === "monitorList") applyMonitorList(state, a[0], true, NOW.getTime());
    else if (name === "info") applyInfo(state, a[0]);
    else if (name === "heartbeatList") applyHeartbeatList(state, a[0], a[1], a[2] === true);
    else if (name === "heartbeat") applyHeartbeat(state, a[0]);
    else if (name === "avgPing") applyAvgPing(state, a[0], a[1]);
    else if (name === "uptime") applyUptime(state, a[0], a[1], a[2]);
    else if (name === "certInfo") applyCertInfo(state, a[0], a[1]);
  }
}

const aliases = parseHostAliases(HOST_ALIASES_JSON);

function captured() {
  const state = createState();
  const buffer = new BeatBuffer();
  const add = buffer.add.bind(buffer);
  state.onBeat = (b) => add(b, NOW.getTime());
  replay(state, loginBurst());
  applyImportantList(state, 5, importantPage(5));
  return { state, buffer };
}

afterEach(() => setSystemTime());

describe("state reducers", () => {
  it("converts Kuma's UTC time format to ISO 8601", () => {
    expect(kumaTimeToIso("2026-09-27 11:58:00.123")).toBe("2026-09-27T11:58:00.123Z");
    expect(kumaTimeToIso("2026-09-27 11:58:00")).toBe("2026-09-27T11:58:00.000Z");
    expect(kumaTimeToIso("2026-10-30T00:00:00.000Z")).toBe("2026-10-30T00:00:00.000Z");
    expect(kumaTimeToIso("nonsense")).toBeNull();
    expect(kumaTimeToIso(42)).toBeNull();
  });

  it("reads beats in both row (snake case) and live (camel case) shapes", () => {
    const row = {
      monitor_id: 3,
      status: 0,
      time: "2026-09-27 11:00:00.000",
      msg: "x",
      ping: null,
      important: 1,
    };
    expect(toBeat(row)).toEqual({
      monitorId: 3,
      ts: "2026-09-27T11:00:00.000Z",
      status: 0,
      pingMs: null,
      msg: "x",
      important: true,
    });
    expect(toBeat(liveBeat(4, 1, 1))?.monitorId).toBe(4);
    expect(toBeat({ ...liveBeat(4, 1, 1), status: 9 })).toBeNull();
  });

  it("parses certInfo JSON strings and tolerates junk", () => {
    const { state } = captured();
    expect(state.cert.get(1)).toEqual({
      valid: true,
      cn: "app.example.com",
      issuer: "R11",
      validTo: "2026-10-30T00:00:00.000Z",
      daysRemaining: 32,
    });
    expect(parseCertInfo("{not json")).toBeNull();
    expect(parseCertInfo(JSON.stringify({ valid: false }))).toBeNull();
  });

  it("merges info events (version only arrives after login)", () => {
    const state = createState();
    applyInfo(state, { serverTimezone: "Asia/Tokyo", serverTimezoneOffset: "+09:00" });
    applyInfo(state, { version: "2.5.5", latestVersion: "2.5.6" });
    expect(state.info).toMatchObject({ version: "2.5.5", latestVersion: "2.5.6", timezone: "Asia/Tokyo" });
  });

  it("keeps the 1y uptime out and clamps ratios", () => {
    const state = createState();
    applyUptime(state, 1, "1y", 0.5);
    applyUptime(state, 1, 24, 1.2);
    expect(state.uptime24.get(1)).toBe(1);
    expect(state.uptime720.has(1)).toBe(false);
  });
});

describe("buildSnapshot", () => {
  const { state, buffer } = captured();
  const beats = buffer.take(2000, NOW.getTime());
  const snap = buildSnapshot(state, NOW, { host: "watch-1", aliases, beats });

  it("passes the shared KumaSnapshot schema and the literal guard", () => {
    expect(KumaSnapshot.safeParse(snap).error?.issues ?? []).toEqual([]);
    expect(guardSnapshot(snap).ok).toBe(true);
    expect(findForbiddenLiterals(JSON.stringify(snap))).toEqual([]);
  });

  it("carries every monitor with mapped targets and no secret fields", () => {
    expect(snap.monitors.map((m) => m.name)).toEqual([
      "API health",
      "Web app",
      "Primary Postgres",
      "Primary SSH",
      "Replica Postgres",
      "Replica SSH",
      "Runner ping",
      "Runner SSH ([redacted])",
      "IPv6 probe",
    ]);
    const byId = new Map(snap.monitors.map((m) => [m.id, m]));
    expect(byId.get(3)).toEqual({
      id: 3,
      name: "Primary Postgres",
      type: "port",
      url: null,
      hostname: "app-1",
      port: 5432,
      method: null,
      intervalS: 60,
      timeoutS: 48,
      active: true,
    });
    expect(byId.get(5)?.hostname).toBe("app-2");
    expect(byId.get(6)?.active).toBe(false);
    expect(byId.get(7)).toMatchObject({ hostname: "runner-1", timeoutS: 10, url: null });
    expect(byId.get(8)?.hostname).toBe("[redacted]");
    expect(byId.get(1)).toMatchObject({ url: "https://app.example.com/api/healthz", method: "GET" });
    expect(byId.get(2)?.url).toBe("https://app.example.com/explore");
    expect(byId.get(9)).toMatchObject({ url: "http://host-v6:8080/health", method: "HEAD" });
    const json = JSON.stringify(snap);
    for (const leak of ["hunter", "Bearer", "basic_auth", "postgres://", "notificationIDList", ADDR.stray]) {
      expect(json).not.toContain(leak);
    }
  });

  it("maps addresses inside heartbeat messages and keeps the port", () => {
    const down = snap.heartbeatsSince.filter((b) => b.monitorId === 5 && b.status === 0);
    expect(down).toHaveLength(2);
    expect(down[0]!.msg).toBe("connect ECONNREFUSED app-2:5432");
    expect(down[0]!.important).toBe(true);
  });

  it("carries only beats inside the 60-minute window, oldest first", () => {
    expect(snap.heartbeatsSince.length).toBe(9 * 60);
    const ts = snap.heartbeatsSince.map((b) => b.ts);
    expect([...ts].sort()).toEqual(ts);
    expect(ts[0]! >= new Date(NOW.getTime() - 3_600_000).toISOString()).toBe(true);
  });

  it("fills per-monitor maps keyed by id", () => {
    expect(snap.uptime["5"]).toEqual({ h24: 0.9861, d30: 0.9995 });
    expect(snap.avgPing["7"]).toBeNull();
    expect(snap.avgPing["1"]).toBe(23.45);
    expect(Object.keys(snap.certInfo)).toEqual(["1", "2"]);
    expect(snap.certInfo["1"]).toMatchObject({ valid: true, cn: "app.example.com", daysRemaining: 32 });
    expect(snap.kuma).toEqual({
      version: "2.5.5",
      latestVersion: "2.5.5",
      dbSizeBytes: null,
      timezone: "Asia/Tokyo (+09:00)",
    });
  });

  it("sends important beats from the paged call, oldest first, scrubbed", () => {
    const five = snap.importantHeartbeats.filter((b) => b.monitorId === 5);
    expect(five.map((b) => b.status)).toEqual([1, 0, 1]);
    expect(five.every((b) => b.important === true)).toBe(true);
    expect(five[1]!.msg).toBe("connect ECONNREFUSED app-2:5432");
  });

  it("reports Kuma down without dropping the last known config", () => {
    const down = buildSnapshot(state, NOW, {
      host: "watch-1",
      aliases,
      reachable: false,
      error: `Kuma login failed at ${ADDR.stray}`,
    });
    const g = guardSnapshot(down);
    expect(g.ok).toBe(true);
    expect(down.reachable).toBe(false);
    expect(down.error).toBe("Kuma login failed at [redacted]");
    expect(down.heartbeatsSince).toEqual([]);
    expect(down.monitors.length).toBe(9);
  });

  it("wires state beats into the buffer", () => {
    // The buffer keeps beats from the last hour of the real clock; pin it to the fixtures' NOW.
    setSystemTime(NOW);
    const s = createState();
    const b = new BeatBuffer();
    wireBuffer(s, b);
    applyHeartbeat(s, liveBeat(1, 0, 1));
    expect(b.size).toBe(1);
  });
});
