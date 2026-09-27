import { describe, expect, it } from "vitest";
import type { Fact } from "../../src/shared/model";
import { buildFactViews, FACT_GROUP_ORDER, latestFacts } from "../../src/shared/view/facts";
import {
  formatBytes,
  formatDuration,
  formatNumber,
  formatRelative,
  humanize,
} from "../../src/shared/view/format";
import { fixtureConfig } from "../fixtures/view";

const NOW = Date.parse("2026-09-27T23:58:00Z");
const thresholds = fixtureConfig.thresholds;

type Raw = string | number | boolean;
function f(group: string, key: string, raw: Raw, over: Partial<Fact> & { ts?: boolean } = {}): Fact {
  const { ts, ...rest } = over;
  const value: Fact["value"] = ts
    ? { type: "timestamp", value: String(raw) }
    : typeof raw === "number"
      ? { type: "number", value: raw }
      : typeof raw === "boolean"
        ? { type: "boolean", value: raw }
        : { type: "string", value: raw };
  return {
    site: "demo",
    source: group === "kuma" ? "kuma:watch-1" : "facts:app-1",
    group,
    key,
    value,
    unit: null,
    severity: null,
    observedAt: "2026-09-27T23:45:00Z",
    freshForS: 1800,
    ...rest,
  };
}

const views = (facts: Fact[], nowMs = NOW) =>
  buildFactViews(latestFacts(facts).values(), { nowMs, thresholds });
const row = (facts: Fact[], key: string, nowMs = NOW) => views(facts, nowMs).index[key]!;
const shown = (facts: Fact[], key: string, nowMs = NOW) => {
  const r = row(facts, key, nowMs);
  return [r.display, r.level];
};

describe("formatters", () => {
  it("durations", () => {
    expect([0, 0.4, 42, 60, 1620, 3600, 3660, 84_720, 86_400, 190_800].map(formatDuration)).toEqual([
      "0 s",
      "0 s",
      "42 s",
      "1 min",
      "27 min",
      "1 h",
      "1 h 1 min",
      "23 h 32 min",
      "1 d",
      "2 d 5 h",
    ]);
    expect(formatDuration(-5)).toBe("0 s");
  });

  it("relative times", () => {
    expect(formatRelative(0.5)).toBe("just now");
    expect(formatRelative(1620)).toBe("27 min ago");
    expect(formatRelative(-84_720)).toBe("in 23 h 32 min");
  });

  it("bytes, numbers and labels", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(77_280_000)).toBe("73.7 MiB");
    expect(formatBytes(12 * 1024 ** 3)).toBe("12.0 GiB");
    expect(formatBytes(3 * 1024 ** 5)).toBe("3.0 PiB");
    expect([41.2, 0.1 + 0.2, 2, 1e6].map(formatNumber)).toEqual(["41.2", "0.3", "2", "1000000"]);
    expect(["lagSeconds", "db_size", "watch-1.status", "x"].map(humanize)).toEqual([
      "Lag seconds",
      "Db size",
      "Watch-1.status",
      "X",
    ]);
  });
});

describe("known groups", () => {
  it("orders the groups the producers send", () => {
    expect(FACT_GROUP_ORDER).toEqual([
      "forgejo",
      "replication",
      "fence",
      "backup",
      "runners",
      "disk",
      "watchdog",
      "kuma",
    ]);
  });

  it("backup: last run age against backupMaxAgeH, next run due, size and duration", () => {
    const last = (at: string) => shown([f("backup", "lastAt", at, { ts: true })], "backup.lastAt");
    expect(last("2026-09-27T23:31:00Z")).toEqual(["27 min ago", "ok"]);
    expect(last("2026-09-26T22:00:00Z")).toEqual(["1 d 1 h ago", "ok"]);
    expect(last("2026-09-26T21:57:00Z")).toEqual(["1 d 2 h ago", "crit"]);
    const next = (at: string) => shown([f("backup", "nextAt", at, { ts: true })], "backup.nextAt");
    expect(next("2026-09-28T23:30:00Z")).toEqual(["in 23 h 32 min", null]);
    expect(next("2026-09-27T23:31:44Z")).toEqual(["due now", "warn"]);
    expect(shown([f("backup", "size", 77_280_000, { unit: "bytes" })], "backup.size")).toEqual([
      "73.7 MiB",
      null,
    ]);
    expect(shown([f("backup", "size", "1.234 GiB")], "backup.size")).toEqual(["1.234 GiB", null]);
    expect(shown([f("backup", "durationS", 102, { unit: "s" })], "backup.durationS")).toEqual([
      "1 min",
      null,
    ]);
    expect(shown([f("backup", "lastResult", "failed", { severity: "crit" })], "backup.lastResult")).toEqual([
      "failed",
      "crit",
    ]);
    expect(shown([f("backup", "lastResult", "none", { severity: "warn" })], "backup.lastResult")).toEqual([
      "no backup yet",
      "warn",
    ]);
    expect(
      shown([f("backup", "nextScheduled", false, { severity: "warn" })], "backup.nextScheduled"),
    ).toEqual(["not scheduled", "warn"]);
    expect(shown([f("backup", "failedStep", "upload")], "backup.failedStep")).toEqual(["upload", "crit"]);
  });

  it("replication: lag against lagWarnS and lagCritS, state streaming or not", () => {
    const lag = (s: number) =>
      shown([f("replication", "lagSeconds", s, { unit: "s" })], "replication.lagSeconds");
    expect(lag(0)).toEqual(["0 s", "ok"]);
    expect(lag(5)).toEqual(["5 s", "ok"]);
    expect(lag(6)).toEqual(["6 s", "warn"]);
    expect(lag(60)).toEqual(["1 min", "warn"]);
    expect(lag(61)).toEqual(["1 min", "crit"]);
    expect(shown([f("replication", "state", "streaming", { severity: "ok" })], "replication.state")).toEqual([
      "streaming",
      "ok",
    ]);
    expect(shown([f("replication", "state", "none", { severity: "warn" })], "replication.state")).toEqual([
      "none",
      "warn",
    ]);
    // The producer's severity wins when it is worse than the derived level.
    expect(shown([f("replication", "state", "catchup", { severity: "crit" })], "replication.state")).toEqual([
      "catchup",
      "crit",
    ]);
    expect(shown([f("replication", "peerReachable", false)], "replication.peerReachable")).toEqual([
      "no",
      "warn",
    ]);
  });

  it("forgejo: health check folds healthzOk, serving node none is crit", () => {
    const facts = [f("forgejo", "healthzCode", 502), f("forgejo", "healthzOk", false)];
    expect(shown(facts, "forgejo.healthzCode")).toEqual(["HTTP 502", "crit"]);
    expect(views(facts).groups[0]!.rows.map((r) => r.key)).toEqual(["healthzCode"]);
    expect(views([f("forgejo", "healthzOk", true)]).groups[0]!.rows.map((r) => r.display)).toEqual(["yes"]);
    expect(shown([f("forgejo", "servingNode", "none")], "forgejo.servingNode")).toEqual(["none", "crit"]);
  });

  it("fence: decision level and a timeline mismatch", () => {
    expect(shown([f("fence", "decision", "serve")], "fence.decision")).toEqual(["serve", "ok"]);
    expect(shown([f("fence", "decision", "fence")], "fence.decision")).toEqual(["fence", "crit"]);
    const tl = [f("fence", "timeline", 3), f("fence", "peerTimeline", 2)];
    expect(shown(tl, "fence.peerTimeline")).toEqual(["2", "warn"]);
  });

  it("runners: online of total, offline warns, list reads as name (status)", () => {
    const facts = [
      f("runners", "online", 1, { severity: "warn" }),
      f("runners", "total", 2),
      f("runners", "offline", "runner-1"),
      f("runners", "list", "watch-1 online, runner-1 offline"),
    ];
    const g = views(facts).groups[0]!;
    expect(g.rows.map((r) => [r.label, r.display, r.level])).toEqual([
      ["Online", "1 of 2", "warn"],
      ["Offline", "runner-1", "warn"],
      ["Runners", "watch-1 (online), runner-1 (offline)", null],
    ]);
    expect(g.level).toBe("warn");
    expect(shown([f("runners", "offline", "none")], "runners.offline")).toEqual(["none", null]);
  });

  it("disk: percent drives a gauge, byte rows fold into the df display", () => {
    const facts = [
      f("disk", "usedBytes", 12 * 1024 ** 3, { unit: "bytes" }),
      f("disk", "sizeBytes", 79 * 1024 ** 3, { unit: "bytes" }),
      f("disk", "percent", 16, { unit: "%", severity: "ok" }),
      f("disk", "display", "12G / 79G (16%)"),
    ];
    const g = views(facts).groups[0]!;
    expect(g.rows.map((r) => [r.label, r.display, r.percent])).toEqual([
      ["Root filesystem", "16%", 16],
      ["Used", "12G / 79G (16%)", null],
    ]);
    expect(views(facts.slice(0, 2)).groups[0]!.rows.map((r) => r.display)).toEqual(["12.0 GiB", "79.0 GiB"]);
    expect(shown([f("disk", "percent", 85, { unit: "%" })], "disk.percent")).toEqual(["85%", "warn"]);
    expect(shown([f("disk", "percent", 93, { unit: "%" })], "disk.percent")).toEqual(["93%", "crit"]);
  });

  it("watchdog: reachability with the HTTP code folded in", () => {
    const facts = [f("watchdog", "reachable", false), f("watchdog", "httpCode", 0)];
    expect(shown(facts, "watchdog.reachable")).toEqual(["unreachable (HTTP 0)", "warn"]);
    expect(views(facts).groups[0]!.rows).toHaveLength(1);
  });

  it("kuma: labels, database size with its unit, an outdated version stays info", () => {
    const facts = [
      f("kuma", "version", "2.5.5", { severity: "ok" }),
      f("kuma", "latestVersion", "2.6.0", { severity: "info" }),
      f("kuma", "dbSize", 41.2, { unit: "MB", severity: "ok" }),
      f("kuma", "reachable", false, { severity: "ok" }),
    ];
    const g = views(facts).groups[0]!;
    expect(g.title).toBe("Uptime Kuma");
    expect(g.rows.map((r) => [r.label, r.display, r.level])).toEqual([
      ["Reachable", "no", "crit"],
      ["Version", "2.5.5", "ok"],
      ["Latest version", "2.6.0", "info"],
      ["Database size", "41.2 MB", "ok"],
    ]);
    expect(g.level).toBe("crit");
  });
});

describe("generic rows and groups", () => {
  it("formats by value type and unit, unknown keys after known ones by label", () => {
    const g = views([
      f("forgejo", "zeta", "text", { unit: "ms" }),
      f("forgejo", "alpha", 1.5, { unit: "GiB" }),
      f("forgejo", "version", "16.0.5"),
      f("forgejo", "uptimeS", 3700, { unit: "s" }),
      f("forgejo", "load", 42, { unit: "%" }),
      f("forgejo", "size", 2048, { unit: "bytes" }),
      f("forgejo", "at", "2026-09-28T01:00:00Z", { ts: true }),
    ]).groups[0]!;
    expect(g.rows.map((r) => [r.label, r.display, r.percent])).toEqual([
      ["Version", "16.0.5", null],
      ["Alpha", "1.5 GiB", null],
      ["At", "in 1 h 2 min", null],
      ["Load", "42%", 42],
      ["Size", "2.0 KiB", null],
      ["Uptime s", "1 h 1 min", null],
      ["Zeta", "text ms", null],
    ]);
  });

  it("a group is not fresh once its newest row is past freshForS; info rows never raise the level", () => {
    const facts = [
      f("x", "a", 1, { observedAt: "2026-09-27T23:00:00Z", freshForS: 600, severity: "info" }),
      f("x", "b", 2, { observedAt: "2026-09-27T23:50:00Z", freshForS: 600 }),
    ];
    expect(views(facts).groups[0]).toMatchObject({
      level: "ok",
      fresh: true,
      observedAt: "2026-09-27T23:50:00Z",
    });
    expect(views(facts, NOW + 3 * 60_000).groups[0]!.fresh).toBe(false);
  });

  it("the newer observation wins when two sources report the same key", () => {
    const facts = [
      f("x", "a", 1, { observedAt: "2026-09-27T23:50:00Z" }),
      f("x", "a", 2, { observedAt: "2026-09-27T23:40:00Z", source: "facts:app-2" }),
    ];
    expect(row(facts, "x.a").display).toBe("1");
  });

  it("clamps a percentage to the gauge range", () => {
    expect(row([f("x", "p", 140, { unit: "%" })], "x.p").percent).toBe(100);
  });
});
