import { describe, expect, it } from "vitest";
import { exportSiteConfig, PROBE_SOURCE_ID, parseSiteConfig, type SiteConfigInput } from "@/shared/config";
import {
  AgentMonitorsResponse,
  advanceRunner,
  confirmMonitor,
  effectiveQuorum,
  freshWindowMs,
  MonitorConfig,
  type MonitorConfigInput,
  monitorServiceKind,
  monitorsOf,
  monitorTargetDisplay,
  ResultsBatch,
  type RunnerMonitorConfig,
  type RunnerState,
  runnerSourceId,
} from "@/shared/monitors";

const PRIVATE4 = [10, 0, 0, 7].join(".");
const NOW = Date.parse("2026-09-28T12:00:00Z");

const base: SiteConfigInput = {
  v: 1,
  slug: "acme",
  name: "Acme",
  hostnames: ["status.acme.example"],
  theme: "a-sys-status",
  sources: [{ id: PROBE_SOURCE_ID, kind: "probe", expectedIntervalS: 60 }],
  probes: [{ id: "home", name: "Home", url: "https://acme.example/" }],
  sections: [],
  branding: { title: "Acme" },
};

const http = (over: Partial<MonitorConfigInput> = {}) =>
  MonitorConfig.parse({
    id: "web",
    name: "Web",
    type: "http",
    url: "https://acme.example/",
    ...over,
  }) as RunnerMonitorConfig;

describe("monitor schema", () => {
  it("defaults to builtin, one retry, one minute and a strict-majority quorum", () => {
    const m = http();
    expect(m).toMatchObject({ runners: ["builtin"], retries: 1, intervalS: 60, timeoutS: 10, enabled: true });
    expect(effectiveQuorum(m)).toBe(1);
    expect(effectiveQuorum({ runners: ["builtin", "a"] })).toBe(2);
    expect(effectiveQuorum({ runners: ["builtin", "a", "b"] })).toBe(2);
    expect(effectiveQuorum({ runners: ["builtin", "a", "b"], quorum: 1 })).toBe(1);
  });

  it("keeps private targets to agent-only monitors and never displays them", () => {
    const tcp = { id: "db", name: "DB", type: "tcp", host: PRIVATE4, port: 5432 } as const;
    expect(MonitorConfig.safeParse(tcp).success).toBe(false);
    expect(MonitorConfig.safeParse({ ...tcp, host: "db.internal" }).success).toBe(false);
    const agentOnly = MonitorConfig.parse({ ...tcp, runners: ["office-1"] });
    expect(monitorTargetDisplay(agentOnly)).toBeNull();
    expect(monitorTargetDisplay(MonitorConfig.parse({ ...tcp, host: "db.acme.example" }))).toBe(
      "db.acme.example:5432",
    );
    expect(monitorTargetDisplay(http({ url: "https://acme.example/health?x=1" }))).toBe(
      "acme.example/health",
    );
  });

  it("rejects a keyword on HEAD, a quorum over the runners and reserved agent ids", () => {
    expect(MonitorConfig.safeParse({ ...http(), method: "HEAD", keyword: "ok" }).success).toBe(false);
    expect(MonitorConfig.safeParse({ ...http(), quorum: 2 }).success).toBe(false);
    expect(MonitorConfig.safeParse({ ...http(), runners: ["cf"] }).success).toBe(false);
  });

  it("maps types to service kinds and runners to sources", () => {
    expect(monitorServiceKind(http())).toBe("http");
    expect(monitorServiceKind(http({ keyword: "ok" }))).toBe("keyword");
    expect(
      monitorServiceKind(MonitorConfig.parse({ id: "t", name: "T", type: "tls", host: "acme.example" })),
    ).toBe("tls");
    expect(runnerSourceId("builtin", "cloudflare")).toBe("probe:cf");
    expect(runnerSourceId("builtin", "docker")).toBe("probe:server");
    expect(runnerSourceId("office-1", "docker")).toBe("probe:office-1");
  });
});

describe("site config", () => {
  it("migrates legacy probes into builtin http monitors with their ids", () => {
    const c = parseSiteConfig(base);
    expect(c.monitors).toEqual([]);
    const [m] = monitorsOf(c);
    expect(m).toMatchObject({ id: "home", type: "http", runners: ["builtin"], retries: 0 });
    const both = parseSiteConfig({
      ...base,
      monitors: [{ id: "home", name: "New", type: "http", url: "https://acme.example/" }],
    });
    expect(monitorsOf(both).map((x) => x.name)).toEqual(["New"]);
  });

  it("requires monitor runners to be declared agents", () => {
    const m = {
      id: "db",
      name: "DB",
      type: "tcp",
      host: "db.lan",
      port: 5432,
      runners: ["office-1"],
    } as const;
    expect(parseSiteConfig.bind(null, { ...base, monitors: [m] })).toThrow(/Unknown agent office-1/);
    expect(
      parseSiteConfig({ ...base, monitors: [m], agents: [{ id: "office-1", name: "Office" }] }).monitors,
    ).toHaveLength(1);
  });

  it("validates maintenance windows", () => {
    const once = {
      kind: "once",
      id: "m",
      title: "Upgrade",
      start: "2026-09-28T10:00:00Z",
      end: "2026-09-28T09:00:00Z",
    };
    expect(() => parseSiteConfig({ ...base, maintenance: [once] })).toThrow(/end must be after start/);
    const weekly = {
      kind: "weekly",
      id: "w",
      title: "Patch",
      days: ["sun"],
      start: "03:00",
      durationMin: 60,
    };
    expect(() =>
      parseSiteConfig({ ...base, maintenance: [{ ...weekly, timeZone: "Mars/Olympus" }] }),
    ).toThrow(/Unknown time zone/);
    expect(
      parseSiteConfig({ ...base, maintenance: [{ ...weekly, timeZone: "Europe/Paris" }] }).maintenance,
    ).toHaveLength(1);
  });

  it("exports monitors and windows canonically (round trip)", () => {
    const text = exportSiteConfig({
      ...base,
      agents: [{ id: "office-1", name: "Office" }],
      monitors: [
        { type: "tls", host: "acme.example", name: "Cert", id: "cert" },
        { runners: ["office-1"], port: 22, host: "nas", type: "tcp", name: "NAS", id: "nas" },
      ],
    });
    expect(exportSiteConfig(parseSiteConfig(text))).toBe(text);
    expect(text.indexOf('"id": "cert"')).toBeLessThan(text.indexOf('"type": "tls"'));
  });
});

describe("confirmation", () => {
  const m = http({ runners: ["builtin", "office-1"], retries: 1 });
  const ts = (s: number) => new Date(NOW - s * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  const run = (runner: string, statuses: ("up" | "down" | "degraded")[]): RunnerState => {
    let st: RunnerState | undefined;
    statuses.forEach((status, i) => {
      st = advanceRunner(st, runner, {
        ts: ts((statuses.length - i) * 60),
        status,
        latencyMs: 5,
        message: status,
      })!;
    });
    return st!;
  };
  const ctx = { nowMs: NOW, inMaintenance: false };

  it("counts consecutive downs and ignores results that are not newer", () => {
    const s = run("builtin", ["down", "up", "down", "down"]);
    expect(s.consecutiveDown).toBe(2);
    expect(advanceRunner(s, "builtin", { ts: ts(60), status: "up", latencyMs: 1, message: "x" })).toBeNull();
  });

  it("is pending until retries are spent, then down only when the quorum agrees", () => {
    expect(confirmMonitor(m, [run("builtin", ["down"]), run("office-1", ["down"])], ctx).status).toBe(
      "pending",
    );
    const one = confirmMonitor(m, [run("builtin", ["down", "down"]), run("office-1", ["up", "up"])], ctx);
    expect(one).toMatchObject({ status: "degraded", message: "down from builtin", downRunners: ["builtin"] });
    const both = confirmMonitor(
      m,
      [run("builtin", ["down", "down"]), run("office-1", ["down", "down"])],
      ctx,
    );
    expect(both).toMatchObject({
      status: "down",
      message: "builtin: down",
      downRunners: ["builtin", "office-1"],
    });
  });

  it("lets the fresh runners decide when one is silent, and is unknown when all are", () => {
    const silent = { ...run("office-1", ["up"]), lastTs: NOW - freshWindowMs(m) - 1 };
    expect(confirmMonitor(m, [run("builtin", ["down", "down"]), silent], ctx).status).toBe("down");
    expect(confirmMonitor(m, [silent], ctx).status).toBe("unknown");
    expect(confirmMonitor(m, [], ctx).status).toBe("unknown");
  });

  it("leaves out runners that cannot run the type", () => {
    const v = confirmMonitor(m, [run("office-1", ["down", "down"])], {
      ...ctx,
      unsupported: new Set(["builtin"]),
    });
    expect(v).toMatchObject({ status: "down", message: "down" });
  });

  it("puts maintenance and pause before any result, and reports degraded checks", () => {
    const down = [run("builtin", ["down", "down"]), run("office-1", ["down", "down"])];
    expect(confirmMonitor(m, down, { ...ctx, inMaintenance: true }).status).toBe("maintenance");
    expect(confirmMonitor({ ...m, enabled: false }, down, ctx).status).toBe("paused");
    const single = http();
    expect(confirmMonitor(single, [run("builtin", ["degraded"])], ctx)).toMatchObject({
      status: "degraded",
      message: "degraded",
    });
    expect(confirmMonitor(single, [run("builtin", ["up"])], ctx)).toMatchObject({
      status: "up",
      latencyMs: 5,
    });
  });
});

describe("agent API", () => {
  it("parses a results batch and a monitors response", () => {
    const batch = ResultsBatch.parse({
      v: 1,
      agent: "uptellis-agent/0.3.0",
      sentAt: "2026-09-28T12:00:00Z",
      results: [
        { monitorId: "nas", ts: "2026-09-28T11:59:00Z", status: "down", latencyMs: null, message: "timeout" },
      ],
    });
    expect(batch.results).toHaveLength(1);
    expect(ResultsBatch.safeParse({ ...batch, results: [] }).success).toBe(false);
    const res = AgentMonitorsResponse.parse({
      v: 1,
      site: "acme",
      runner: "office-1",
      generatedAt: "2026-09-28T12:00:00Z",
      monitors: [{ id: "nas", name: "NAS", type: "tcp", host: PRIVATE4, port: 22, runners: ["office-1"] }],
      pollS: 60,
    });
    expect(res.monitors[0]).toMatchObject({ retries: 1, runners: ["office-1"] });
  });
});
