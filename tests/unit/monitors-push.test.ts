/**
 * Push monitors over memory: the schema (bounds, defaults, no runners), what never runs them (`RUNNER_TYPES`,
 * implied sources, the agent API), how a push result confirms (final, one runner), the push route's message
 * and latency rules, and the silent rule of the every-minute job (clock from creation or the last push, one
 * transition, heartbeats per interval, maintenance, pause and removal).
 */
import { describe, expect, it } from "vitest";
import { PROBE_SOURCE_ID, type SiteConfig } from "@/shared/config";
import {
  AgentId,
  type CheckResult,
  confirmMonitor,
  formatSeconds,
  MONITOR_TYPES,
  MonitorConfig,
  monitorRunners,
  monitorServiceId,
  monitorServiceKind,
  monitorTargetDisplay,
  PUSH_RUNNER,
  PUSH_SOURCE_ID,
  RUNNER_TYPES,
  type RunnerState,
  removedMonitorOf,
} from "@/shared/monitors";
import type { ConfigSource } from "@/worker/engine/sites";
import { siteSources } from "@/worker/engine/sites";
import { applyResults } from "@/worker/monitors/apply";
import { type PushStore, silentMessage, WAITING_MESSAGE, watchPushMonitors } from "@/worker/monitors/push";
import type { PushWatch } from "@/worker/monitors/push-store";
import { agentMonitors } from "@/worker/routes/agent";
import { MAX_PUSH_MSG, pushLatency, pushMessage } from "@/worker/routes/push";
import { memoryMonitors, monitorSite } from "../support/monitors";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const iso = (t: number) => new Date(t).toISOString().replace(".000Z", "Z");
const min = (n: number) => NOW + n * 60_000;
const PRIVATE4 = [10, 0, 0, 7].join(".");

const push = (over: Record<string, unknown> = {}) =>
  MonitorConfig.parse({ id: "backup", name: "Nightly backup", type: "push", ...over });

describe("push monitor schema", () => {
  it("takes an interval and a grace with a one minute default grace, and no runners", () => {
    const m = push({ intervalS: 300 });
    expect(m).toEqual({
      id: "backup",
      name: "Nightly backup",
      type: "push",
      intervalS: 300,
      graceS: 60,
      enabled: true,
    });
    expect(push()).toMatchObject({ intervalS: 60, graceS: 60 });
    // Runner fields are not part of a push monitor: they are dropped, never kept.
    expect(push({ runners: ["builtin"], quorum: 1, retries: 3 })).not.toHaveProperty("runners");
    expect(monitorRunners(m)).toEqual([PUSH_RUNNER]);
  });

  it("bounds the interval to 1 minute .. 1 day and the grace to 0 .. 1 day", () => {
    const ok = (over: Record<string, unknown>) =>
      MonitorConfig.safeParse({ id: "b", name: "B", type: "push", ...over }).success;
    expect(ok({ intervalS: 60 })).toBe(true);
    expect(ok({ intervalS: 86_400 })).toBe(true);
    expect(ok({ intervalS: 90 })).toBe(true);
    expect(ok({ intervalS: 59 })).toBe(false);
    expect(ok({ intervalS: 86_401 })).toBe(false);
    expect(ok({ intervalS: 120.5 })).toBe(false);
    expect(ok({ graceS: 0 })).toBe(true);
    expect(ok({ graceS: 86_400 })).toBe(true);
    expect(ok({ graceS: -1 })).toBe(false);
    expect(ok({ graceS: 86_401 })).toBe(false);
  });

  it("shows as a push service with its schedule as the target, never a URL", () => {
    const m = push({ intervalS: 300 });
    expect(monitorServiceId(m.id)).toBe("probe:backup");
    expect(monitorServiceKind(m)).toBe("push");
    expect(monitorTargetDisplay(m)).toBe("heartbeat every 5 min");
    expect(monitorTargetDisplay(push({ intervalS: 86_400 }))).toBe("heartbeat every 1 day");
    expect(formatSeconds(5400)).toBe("1 h 30 min");
    expect(formatSeconds(90)).toBe("1 min 30 s");
  });

  it("is never run by a runner and implies no source", () => {
    expect(MONITOR_TYPES).toContain("push");
    expect(RUNNER_TYPES).toEqual({
      cloudflare: ["http", "tcp"],
      docker: ["http", "tcp", "ping", "tls"],
      agent: ["http", "tcp", "ping", "tls"],
    });
    const only = monitorSite({ monitors: [push()], probes: [] });
    expect(siteSources(only, "cloudflare")).toEqual([]);
    expect(siteSources(only, "docker")).toEqual([]);
    const mixed = monitorSite({
      agents: [{ id: "office-1", name: "Office" }],
      monitors: [
        push(),
        { id: "nas", name: "NAS", type: "ping", host: "nas.lan", runners: ["office-1"] },
        { id: "web", name: "Web", type: "http", url: "https://example.com/" },
      ],
    });
    expect(siteSources(mixed, "cloudflare").map((s) => s.id)).toEqual(["probe:office-1", PROBE_SOURCE_ID]);
    expect(agentMonitors(mixed, "office-1").map((m) => m.id)).toEqual(["nas"]);
    expect(agentMonitors(mixed, PUSH_RUNNER)).toEqual([]);
    expect(AgentId.safeParse(PUSH_RUNNER).success).toBe(false);
  });

  it("follows its monitor like any other: removed when the config drops it", () => {
    const withIt = monitorSite({ monitors: [push()] });
    expect(removedMonitorOf(withIt)("probe:backup")).toBe(false);
    expect(removedMonitorOf(monitorSite({ monitors: [] }))("probe:backup")).toBe(true);
  });
});

describe("confirming a push result", () => {
  const state = (lastStatus: RunnerState["lastStatus"], ago: number, over: Partial<RunnerState> = {}) => ({
    runner: PUSH_RUNNER,
    lastTs: NOW - ago,
    lastStatus,
    consecutiveDown: lastStatus === "down" ? 1 : 0,
    latencyMs: lastStatus === "up" ? 12 : null,
    message: lastStatus === "up" ? "OK" : "disk full",
    ...over,
  });
  const ctx = { nowMs: NOW, inMaintenance: false };

  it("is final: up with its latency, down at once, and never too old to count", () => {
    const m = push({ intervalS: 60 });
    expect(confirmMonitor(m, [state("up", 1000)], ctx)).toEqual({
      status: "up",
      latencyMs: 12,
      message: "OK",
      downRunners: [],
    });
    expect(confirmMonitor(m, [state("down", 1000)], ctx)).toMatchObject({
      status: "down",
      message: "disk full",
      downRunners: [PUSH_RUNNER],
    });
    // A day old: still the verdict (silence is the silent rule's own down result).
    expect(confirmMonitor(m, [state("up", 86_400_000)], ctx).status).toBe("up");
    expect(confirmMonitor(m, [], ctx)).toMatchObject({ status: "unknown" });
    // Results of any other runner are not the push monitor's.
    expect(confirmMonitor(m, [{ ...state("down", 1000), runner: "builtin" }], ctx).status).toBe("unknown");
  });

  it("is paused when disabled and maintenance inside a window", () => {
    expect(confirmMonitor(push({ enabled: false }), [state("down", 0)], ctx).status).toBe("paused");
    expect(confirmMonitor(push(), [state("down", 0)], { ...ctx, inMaintenance: true }).status).toBe(
      "maintenance",
    );
  });
});

describe("push route parameters", () => {
  it("keeps a message display-safe and at most 200 characters", () => {
    expect(pushMessage(undefined, "up")).toBe("OK");
    expect(pushMessage("", "down")).toBe("down");
    expect(pushMessage("  backup\u0000 done\n\tin 4 s ", "up")).toBe("backup done in 4 s");
    const email = ["ops", "example.org"].join("@");
    expect(pushMessage(`copied to ${PRIVATE4} as ${email}`, "up")).toBe("copied to [redacted] as [redacted]");
    const long = pushMessage("x".repeat(500), "up");
    expect(long).toHaveLength(MAX_PUSH_MSG);
  });

  it("reads ping as whole milliseconds and ignores anything else", () => {
    expect(pushLatency("42")).toBe(42);
    expect(pushLatency("41.6")).toBe(42);
    expect(pushLatency("")).toBeNull();
    expect(pushLatency(undefined)).toBeNull();
    expect(pushLatency("-5")).toBeNull();
    expect(pushLatency("fast")).toBeNull();
  });
});

describe("applyResults for push monitors", () => {
  it("takes their results from the push runner only, and push results for nothing else", async () => {
    const config = monitorSite({
      monitors: [push(), { id: "web", name: "Web", type: "http", url: "https://example.com/" }],
    });
    const { backend, store } = memoryMonitors(config);
    const r = (monitorId: string, status: CheckResult["status"]): CheckResult => ({
      monitorId,
      ts: iso(min(0)),
      status,
      latencyMs: status === "up" ? 30 : null,
      message: status === "up" ? "OK" : "failed",
    });
    const builtin = await applyResults(
      backend,
      { site: "demo", runner: "builtin", runtime: "docker" },
      [r("backup", "up")],
      new Date(min(0) + 1000),
    );
    expect(builtin).toMatchObject({ accepted: 0, ignored: 1 });
    const pushed = await applyResults(
      backend,
      { site: "demo", runner: PUSH_RUNNER, runtime: "cloudflare" },
      [r("backup", "up"), r("web", "down")],
      new Date(min(0) + 1000),
    );
    expect(pushed).toMatchObject({ accepted: 1, ignored: 1, source: PUSH_SOURCE_ID });
    expect(store.services.get("probe:backup")).toMatchObject({
      source: PUSH_SOURCE_ID,
      kind: "push",
      status: "up",
      latencyMs: 30,
      targetDisplay: "heartbeat every 1 min",
      intervalS: 60,
    });
    expect(store.services.get("probe:backup")).not.toHaveProperty("timeoutS");
    // A down push is down at once: no retries.
    const down = await applyResults(
      backend,
      { site: "demo", runner: PUSH_RUNNER, runtime: "cloudflare" },
      [{ ...r("backup", "down"), ts: iso(min(1)) }],
      new Date(min(1) + 1000),
    );
    expect(down.incidents.opened).toEqual([`probe:backup:${iso(min(1))}`]);
  });
});

/** Push rows over memory, as `PushTokenStore` keeps them. */
class MemoryPushes implements PushStore {
  readonly rows = new Map<string, PushWatch>();
  async watches(_site: string) {
    return [...this.rows.values()].map((w) => ({ ...w }));
  }
  async arm(_site: string, monitorId: string, configVersion: number, nowMs: number) {
    const cur = this.rows.get(monitorId);
    if (!cur) this.rows.set(monitorId, { monitorId, lastPushAt: null, watchSince: nowMs, configVersion });
    else if (cur.watchSince === null) cur.watchSince = nowMs;
  }
  async disarm(_site: string, monitorId: string) {
    const cur = this.rows.get(monitorId);
    if (cur) cur.watchSince = null;
  }
  async forget(_site: string, monitorIds: readonly string[]) {
    for (const id of monitorIds) this.rows.delete(id);
  }
}

/** A site whose config (and version) the test changes, with push rows over memory. */
function harness(monitors: unknown[], over: Record<string, unknown> = {}) {
  const current = { config: monitorSite({ monitors, ...over }), version: 1 };
  const configs: ConfigSource = {
    current: async (slug) =>
      slug === "demo" ? { ...current, savedAt: "1970-01-01T00:00:00Z", savedBy: "test" } : null,
    slugs: async () => ["demo"],
  };
  const mem = memoryMonitors(current.config);
  const pushes = new MemoryPushes();
  const backend = { ...mem.backend, configs, pushes };
  const tick = (t: number) => watchPushMonitors(backend, "cloudflare", t);
  /** A push as the route applies it: the push is recorded, then applied as runner `push`. */
  const pushAt = async (t: number, status: CheckResult["status"] = "up", message = "OK") => {
    const row = pushes.rows.get("backup");
    if (row) row.lastPushAt = t;
    return applyResults(
      backend,
      { site: "demo", runner: PUSH_RUNNER, runtime: "cloudflare" },
      [{ monitorId: "backup", ts: iso(t), status, latencyMs: status === "up" ? 20 : null, message }],
      new Date(t),
    );
  };
  const setConfig = (config: SiteConfig) => {
    current.config = config;
    current.version++;
  };
  return { ...mem, pushes, tick, pushAt, setConfig, current };
}

const status = (h: ReturnType<typeof harness>) => h.store.services.get("probe:backup")?.status;
const beats = (h: ReturnType<typeof harness>) =>
  [...h.store.heartbeats.values()]
    .filter((b) => b.serviceId === "probe:backup")
    .map((b) => [b.ts, b.status, b.important, b.message]);

describe("silent rule", () => {
  it("waits interval plus grace from creation, then writes one down result, not one a minute", async () => {
    const h = harness([push({ intervalS: 300, graceS: 60 })]);
    await h.tick(min(0));
    expect(h.pushes.rows.get("backup")).toMatchObject({ watchSince: min(0), lastPushAt: null });
    expect(h.store.services.get("probe:backup")).toMatchObject({
      status: "pending",
      source: PUSH_SOURCE_ID,
      kind: "push",
    });
    for (let n = 1; n <= 5; n++) expect((await h.tick(min(n))).down).toBe(0);
    expect(status(h)).toBe("pending");

    const at6 = await h.tick(min(6));
    expect(at6).toMatchObject({ down: 1, opened: [`probe:backup:${iso(min(6))}`] });
    expect(status(h)).toBe("down");
    expect(h.runners.get("demo", "backup", PUSH_RUNNER)).toMatchObject({
      lastStatus: "down",
      consecutiveDown: 1,
      message: "no push for 6 min",
    });
    const saves = h.runners.saves;
    for (let n = 7; n <= 16; n++) expect((await h.tick(min(n))).down).toBe(0);
    // No further result: the runner state is untouched and no incident opened again.
    expect(h.runners.saves).toBe(saves);
    expect(h.runners.get("demo", "backup", PUSH_RUNNER)?.lastTs).toBe(min(6));
    expect([...h.store.incidents.values()].filter((i) => !i.endedAt)).toHaveLength(1);
    // One heartbeat per interval (5 min, on aligned minutes) keeps the bars and uptime counting it down.
    expect(beats(h)).toEqual([
      [iso(min(6)), "down", true, "no push for 6 min"],
      [iso(min(10)), "down", false, "no push for 10 min"],
      [iso(min(15)), "down", false, "no push for 15 min"],
    ]);

    // The next push brings it up and resolves the incident.
    const up = await h.pushAt(min(17) + 5_000);
    expect(up.incidents.resolved).toEqual([`probe:backup:${iso(min(6))}`]);
    expect(status(h)).toBe("up");
  });

  it("counts from the last push, and a down push is down at once", async () => {
    const h = harness([push({ intervalS: 60, graceS: 30 })]);
    await h.tick(min(0));
    await h.pushAt(min(0) + 20_000);
    expect(status(h)).toBe("up");
    expect((await h.tick(min(1))).down).toBe(0);
    await h.pushAt(min(1) + 10_000);
    expect((await h.tick(min(2))).down).toBe(0);
    // 90 s after the last push (min 1 + 10 s): down at min 3.
    expect((await h.tick(min(3))).down).toBe(1);
    expect(h.runners.get("demo", "backup", PUSH_RUNNER)?.message).toBe("no push for 1 min");
    await h.pushAt(min(3) + 30_000);
    expect(status(h)).toBe("up");
    const d = await h.pushAt(min(3) + 45_000, "down", "disk full");
    expect(d.incidents.opened).toHaveLength(1);
    expect(h.store.services.get("probe:backup")).toMatchObject({ status: "down", latencyMs: null });
    expect(beats(h).at(-1)).toEqual([iso(min(3) + 45_000), "down", true, "disk full"]);
  });

  it("inside a maintenance window writes no incident, and goes down when it ends still silent", async () => {
    const window = {
      kind: "once",
      id: "backup-work",
      title: "Backup server work",
      services: ["probe:backup"],
      start: iso(min(0)),
      end: iso(min(10)),
    };
    const h = harness([push({ intervalS: 60, graceS: 0 })], { maintenance: [window] });
    await h.tick(min(0));
    const inside = await h.tick(min(2));
    expect(inside).toMatchObject({ down: 1, opened: [] });
    expect(status(h)).toBe("maintenance");
    for (let n = 3; n < 10; n++) expect((await h.tick(min(n))).opened).toEqual([]);
    expect(beats(h).filter(([, s]) => s !== "maintenance")).toEqual([]);
    const after = await h.tick(min(10));
    expect(after).toMatchObject({ down: 1, opened: [`probe:backup:${iso(min(10))}`] });
    expect(status(h)).toBe("down");
    expect((await h.tick(min(11))).down).toBe(0);
  });

  it("stops while paused, shows paused, and restarts the clock when enabled again", async () => {
    const h = harness([push({ intervalS: 60, graceS: 0 })]);
    await h.tick(min(0));
    await h.pushAt(min(0) + 1_000);
    h.setConfig(monitorSite({ monitors: [push({ intervalS: 60, graceS: 0, enabled: false })] }));
    await h.tick(min(1));
    expect(status(h)).toBe("paused");
    expect(h.pushes.rows.get("backup")?.watchSince).toBeNull();
    for (let n = 2; n < 30; n++) expect((await h.tick(min(n))).down).toBe(0);

    h.setConfig(monitorSite({ monitors: [push({ intervalS: 60, graceS: 0 })] }));
    await h.tick(min(30));
    expect(h.pushes.rows.get("backup")?.watchSince).toBe(min(30));
    expect(h.store.services.get("probe:backup")).toMatchObject({ status: "pending" });
    expect(h.store.heartbeats.size).toBeGreaterThan(0);
    expect((await h.tick(min(31))).down).toBe(1);
    expect(status(h)).toBe("down");
  });

  it("forgets the rows of a removed monitor once a newer config version drops it", async () => {
    const h = harness([push()]);
    await h.tick(min(0));
    expect(h.pushes.rows.has("backup")).toBe(true);
    // A row armed or issued against version 2 survives a job that still reads version 1 (cached).
    h.pushes.rows.get("backup")!.configVersion = 2;
    h.current.config = monitorSite({ monitors: [] });
    await h.tick(min(1));
    expect(h.pushes.rows.has("backup")).toBe(true);
    h.setConfig(monitorSite({ monitors: [] }));
    h.setConfig(monitorSite({ monitors: [] }));
    await h.tick(min(2));
    expect(h.pushes.rows.has("backup")).toBe(false);
  });

  it("names the silence in whole minutes", () => {
    expect(silentMessage(61_000)).toBe("no push for 1 min");
    expect(silentMessage(3_700_000)).toBe("no push for 1 h 1 min");
    expect(WAITING_MESSAGE).toBe("waiting for a push");
  });
});
