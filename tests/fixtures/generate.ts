// Regenerates tests/fixtures/data/{default,stale,incident}.json.
// Run: bun tests/fixtures/generate.ts
//
// Synthetic data for the demo site (sites/demo.json), "Acme Cloud". Every target is written out by
// hand as a hostname, every entity uses the model's exact shape (src/shared/model), and every fixture
// is parsed through the model's Zod schemas before it is written.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type CertSummary,
  type Fact,
  type FactSeverity,
  type FactValueType,
  factValueFrom,
  type Heartbeat,
  type Incident,
  serviceId as modelServiceId,
  type Service,
  type Source,
} from "../../src/shared/model";
import { type FixtureDayCell, type FixtureHistory, type FixtureModel, parseFixture } from "./index";

const SITE = "demo";
const DAY = "2026-09-27";
const NOW = `${DAY}T23:58:00Z`;
const KUMA = "kuma:watch-1";
const FACTS = "facts:app-1";
const KUMA_LAST_SEEN = `${DAY}T23:57:26Z`; // snapshotAgeSeconds 34
const FACTS_LAST_SEEN = `${DAY}T23:45:00Z`;
const HISTORY_DAYS = 90;
const GIB = 1024 ** 3;

type Beat = [time: string, message: string, latencyMs: number];

interface MonitorSpec {
  kumaId: number;
  name: string;
  kind: "http" | "port" | "ping";
  targetDisplay: string;
  intervalS: number;
  status: "up";
  latencyMs: number;
  avgLatencyMs: number;
  /** Ratio 0..1, as Kuma reports it. */
  uptime24h: number;
  uptime30d: number;
  cert?: CertSummary;
  recent: Beat[];
  /** Day offsets back from today (0 = today) that are not plain green. */
  marks?: Record<number, { worst: "down" | "degraded"; minutesDown: number }>;
}

const CERT_VALID_TO = "2026-12-10T08:12:00Z";
const cert: CertSummary = {
  valid: true,
  cn: "example.com",
  issuer: "Example CA",
  validTo: CERT_VALID_TO,
  // Whole days left at the snapshot, rounded down (the mock-up showed 74, rounded up).
  daysRemaining: Math.floor((Date.parse(CERT_VALID_TO) - Date.parse(NOW)) / 86_400_000),
};

// beatBarNote: Replica Postgres and SSH have 2 red days around day 12 (the app-2
// reboot, Sep 15 and 16); API health has one degraded day around day 2 (a 47 s
// reboot, Sep 25). Everything else is green.
const app2Reboot = {
  12: { worst: "down", minutesDown: 42 },
  11: { worst: "down", minutesDown: 18 },
} as const;

const MONITORS: MonitorSpec[] = [
  {
    kumaId: 1,
    name: "API health",
    kind: "http",
    targetDisplay: "example.com/api/healthz",
    intervalS: 30,
    status: "up",
    latencyMs: 388,
    avgLatencyMs: 402,
    uptime24h: 1,
    uptime30d: 0.9997,
    cert,
    recent: [
      ["23:57:41", "200 - OK", 371],
      ["23:57:11", "200 - OK", 402],
      ["23:56:41", "200 - OK", 389],
      ["23:56:11", "200 - OK", 410],
      ["23:55:41", "200 - OK", 377],
    ],
    marks: { 2: { worst: "degraded", minutesDown: 1 } },
  },
  {
    kumaId: 2,
    name: "Web app",
    kind: "http",
    targetDisplay: "example.com/",
    intervalS: 60,
    status: "up",
    latencyMs: 512,
    avgLatencyMs: 498,
    uptime24h: 1,
    uptime30d: 0.9997,
    cert,
    recent: [
      ["23:57:20", "200 - OK", 512],
      ["23:56:20", "200 - OK", 488],
      ["23:55:20", "200 - OK", 530],
      ["23:54:20", "200 - OK", 496],
      ["23:53:20", "200 - OK", 505],
    ],
  },
  {
    kumaId: 3,
    name: "Primary Postgres",
    kind: "port",
    targetDisplay: "app-1:5432",
    intervalS: 60,
    status: "up",
    latencyMs: 131,
    avgLatencyMs: 129,
    uptime24h: 1,
    uptime30d: 1,
    recent: [
      ["23:57:05", "open", 131],
      ["23:56:05", "open", 128],
      ["23:55:05", "open", 130],
      ["23:54:05", "open", 127],
      ["23:53:05", "open", 133],
    ],
  },
  {
    kumaId: 4,
    name: "Primary SSH",
    kind: "port",
    targetDisplay: "app-1:22",
    intervalS: 60,
    status: "up",
    latencyMs: 129,
    avgLatencyMs: 130,
    uptime24h: 1,
    uptime30d: 1,
    recent: [
      ["23:57:09", "open", 129],
      ["23:56:09", "open", 131],
      ["23:55:09", "open", 128],
      ["23:54:09", "open", 130],
      ["23:53:09", "open", 129],
    ],
  },
  {
    kumaId: 5,
    name: "Replica Postgres",
    kind: "port",
    targetDisplay: "app-2:5432",
    intervalS: 60,
    status: "up",
    latencyMs: 217,
    avgLatencyMs: 214,
    uptime24h: 1,
    uptime30d: 0.9986,
    recent: [
      ["23:57:12", "open", 217],
      ["23:56:12", "open", 211],
      ["23:55:12", "open", 219],
      ["23:54:12", "open", 215],
      ["23:53:12", "open", 213],
    ],
    marks: app2Reboot,
  },
  {
    kumaId: 6,
    name: "Replica SSH",
    kind: "port",
    targetDisplay: "app-2:22",
    intervalS: 60,
    status: "up",
    latencyMs: 214,
    avgLatencyMs: 216,
    uptime24h: 1,
    uptime30d: 0.9986,
    recent: [
      ["23:57:15", "open", 214],
      ["23:56:15", "open", 218],
      ["23:55:15", "open", 212],
      ["23:54:15", "open", 216],
      ["23:53:15", "open", 215],
    ],
    marks: app2Reboot,
  },
  {
    kumaId: 8,
    name: "Runner ping",
    kind: "ping",
    targetDisplay: "runner-1",
    intervalS: 60,
    status: "up",
    latencyMs: 1,
    avgLatencyMs: 1,
    uptime24h: 1,
    uptime30d: 1,
    recent: [
      ["23:57:30", "1 ms", 1],
      ["23:56:30", "1 ms", 1],
      ["23:55:30", "1 ms", 1],
      ["23:54:30", "1 ms", 1],
      ["23:53:30", "1 ms", 1],
    ],
  },
  {
    kumaId: 9,
    name: "Runner SSH",
    kind: "port",
    targetDisplay: "runner-1:22",
    intervalS: 60,
    status: "up",
    latencyMs: 2,
    avgLatencyMs: 2,
    uptime24h: 1,
    uptime30d: 1,
    recent: [
      ["23:57:33", "open", 2],
      ["23:56:33", "open", 2],
      ["23:55:33", "open", 2],
      ["23:54:33", "open", 2],
      ["23:53:33", "open", 2],
    ],
  },
];

const serviceId = (kumaId: number) => modelServiceId("kuma", kumaId);
const at = (hms: string, day = DAY) => `${day}T${hms}Z`;
const ratio = (minutesDown: number) => Math.round(((1440 - minutesDown) / 1440) * 1e6) / 1e6;
/** Incident ids use only `[A-Za-z0-9:._-]`: `<serviceId>:<startedAt>`. */
const incidentId = (svc: string, startedAt: string) => `${svc}:${startedAt}`;

function dayString(offsetBack: number): string {
  const d = new Date(`${DAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - offsetBack);
  return d.toISOString().slice(0, 10);
}

function history(m: MonitorSpec): FixtureHistory {
  const days: FixtureDayCell[] = [];
  for (let back = HISTORY_DAYS - 1; back >= 0; back--) {
    const mark = m.marks?.[back];
    const minutesDown = mark?.minutesDown ?? 0;
    days.push({ day: dayString(back), worst: mark?.worst ?? "up", uptime: ratio(minutesDown), minutesDown });
  }
  return { serviceId: serviceId(m.kumaId), days };
}

function fact(
  group: string,
  key: string,
  raw: string | number | boolean,
  opts: { type?: FactValueType; unit?: string; severity?: FactSeverity | null; source?: string } = {},
): Fact {
  const value = factValueFrom(raw, opts.type);
  if (!value) throw new Error(`fact ${group}.${key}: ${String(raw)} does not fit ${opts.type ?? "its type"}`);
  return {
    site: SITE,
    source: opts.source ?? FACTS,
    group,
    key,
    value,
    unit: opts.unit ?? null,
    severity: opts.severity === undefined ? "ok" : opts.severity,
    observedAt: opts.source === KUMA ? KUMA_LAST_SEEN : FACTS_LAST_SEEN,
    freshForS: opts.source === KUMA ? 300 : 1800,
  };
}

function buildDefault(): FixtureModel {
  const services: Service[] = MONITORS.map((m) => ({
    id: serviceId(m.kumaId),
    site: SITE,
    source: KUMA,
    externalId: String(m.kumaId),
    name: m.name,
    kind: m.kind,
    targetDisplay: m.targetDisplay,
    intervalS: m.intervalS,
    status: m.status,
    latencyMs: m.latencyMs,
    avgLatencyMs: m.avgLatencyMs,
    uptime24h: m.uptime24h,
    uptime30d: m.uptime30d,
    ...(m.cert ? { cert: m.cert } : {}),
  }));

  const heartbeats: Heartbeat[] = MONITORS.flatMap((m) =>
    m.recent.map(([time, message, latencyMs]) => ({
      site: SITE,
      serviceId: serviceId(m.kumaId),
      ts: at(time),
      status: "up" as const,
      latencyMs,
      message,
      important: false,
    })),
  );

  // Resolved incidents for the app-2 reboot (the two red days in the history).
  const incidents: Incident[] = [5, 6].flatMap((kumaId) => {
    const name = MONITORS.find((m) => m.kumaId === kumaId)!.name;
    return [
      { start: `${dayString(12)}T03:10:00Z`, end: `${dayString(12)}T03:52:00Z` },
      { start: `${dayString(11)}T02:40:00Z`, end: `${dayString(11)}T02:58:00Z` },
    ].map(({ start, end }) => ({
      id: incidentId(serviceId(kumaId), start),
      site: SITE,
      kind: "down" as const,
      serviceId: serviceId(kumaId),
      sourceId: null,
      startedAt: start,
      endedAt: end,
      title: `${name} down`,
      notes: null,
    }));
  });

  // Exactly the groups, keys, types, units and severities the live producers send: kuma facts as
  // src/worker/adapters/kuma.ts builds them, the rest as profiles/forgejo-ha/push-facts.sh gathers them on app-1.
  const facts: Fact[] = [
    fact("kuma", "host", "watch-1", { source: KUMA }),
    fact("kuma", "reachable", true, { source: KUMA }),
    fact("kuma", "version", "2.5.5", { source: KUMA }),
    fact("kuma", "latestVersion", "2.5.5", { source: KUMA }),
    fact("kuma", "dbSize", 41.2, { unit: "MB", source: KUMA }),
    fact("kuma", "timezone", "Asia/Tokyo (+09:00)", { source: KUMA }),
    fact("forgejo", "node", "app-1", { severity: null }),
    fact("forgejo", "serving", true),
    fact("forgejo", "servingNode", "app-1", { severity: null }),
    fact("forgejo", "version", "16.0.5", { severity: null }),
    fact("forgejo", "healthzCode", 200),
    fact("forgejo", "healthzOk", true),
    fact("replication", "role", "primary", { severity: null }),
    fact("replication", "state", "streaming"),
    fact("replication", "standbyConnected", true),
    fact("replication", "lagSeconds", 0, { unit: "s", severity: null }),
    fact("replication", "peer", "app-2", { severity: null }),
    fact("replication", "peerReachable", true),
    fact("fence", "decision", "serve"),
    fact("fence", "reason", "peer is a standby", { severity: null }),
    fact("fence", "timeline", 1, { severity: null }),
    fact("fence", "peerRole", "standby", { severity: null }),
    fact("fence", "peerTimeline", 1, { severity: null }),
    fact("backup", "lastAt", `${DAY}T23:31:44Z`, { type: "timestamp", severity: null }),
    fact("backup", "lastResult", "ok"),
    fact("backup", "snapshot", "5e7d0a42", { severity: null }),
    // restic's own formatting, passed through as text by push-facts.sh.
    fact("backup", "size", "73.7 MiB", { severity: null }),
    fact("backup", "durationS", 18, { unit: "s", severity: null }),
    fact("backup", "nextAt", "2026-09-28T23:30:00Z", { type: "timestamp", severity: null }),
    fact("runners", "online", 2),
    fact("runners", "total", 2, { severity: null }),
    fact("runners", "offline", "none", { severity: null }),
    fact("runners", "list", "runner-1 idle, watch-1 idle", { severity: null }),
    fact("disk", "usedBytes", 12 * GIB, { unit: "bytes", severity: null }),
    fact("disk", "sizeBytes", 79 * GIB, { unit: "bytes", severity: null }),
    fact("disk", "percent", 16, { unit: "%" }),
    fact("disk", "display", "12G / 79G (16%)", { severity: null }),
    fact("watchdog", "reachable", true),
    fact("watchdog", "httpCode", 200, { severity: null }),
  ];

  const sources: Source[] = [
    {
      id: KUMA,
      site: SITE,
      kind: "kuma",
      expectedIntervalS: 60,
      lastSeenAt: KUMA_LAST_SEEN,
      lastOkAt: KUMA_LAST_SEEN,
    },
    {
      id: FACTS,
      site: SITE,
      kind: "facts",
      expectedIntervalS: 900,
      lastSeenAt: FACTS_LAST_SEEN,
      lastOkAt: FACTS_LAST_SEEN,
    },
  ];

  return {
    site: {
      slug: SITE,
      name: "Acme Cloud",
      hostnames: ["status.example.com"],
      configVersion: 1,
    },
    sources,
    services,
    heartbeats,
    history: MONITORS.map(history),
    incidents,
    facts,
    now: NOW,
  };
}

function buildStale(): FixtureModel {
  const f = buildDefault();
  // 14 minutes after the kuma source last reported (and 26 after facts).
  f.now = new Date(Date.parse(KUMA_LAST_SEEN) + 14 * 60_000).toISOString().replace(".000Z", "Z");
  return f;
}

function buildIncident(): FixtureModel {
  const f = buildDefault();
  const id = serviceId(5);
  const startedAt = `${DAY}T23:52:00Z`; // 6 minutes before now
  const svc = f.services.find((s) => s.id === id)!;
  Object.assign(svc, { status: "down", latencyMs: null, uptime24h: 0.9958, uptime30d: 0.9985 });

  f.heartbeats = f.heartbeats.filter((h) => h.serviceId !== id);
  const downBeats: Heartbeat[] = ["23:52:00", "23:53:00", "23:54:00", "23:55:00", "23:56:00", "23:57:00"].map(
    (t, i) => ({
      site: SITE,
      serviceId: id,
      ts: at(t),
      status: "down",
      latencyMs: null,
      message: "timeout",
      important: i === 0,
    }),
  );
  f.heartbeats.push(...downBeats);

  const hist = f.history.find((h) => h.serviceId === id)!;
  const today = hist.days[hist.days.length - 1]!;
  Object.assign(today, { worst: "down", minutesDown: 6, uptime: ratio(6) });

  f.incidents.push({
    id: incidentId(id, startedAt),
    site: SITE,
    kind: "down",
    serviceId: id,
    sourceId: null,
    startedAt,
    endedAt: null,
    title: "Replica Postgres down",
    notes: null,
  });

  // Postgres on app-2 is down: push-facts.sh on app-1 then finds no row in pg_stat_replication
  // (state "none", no lag), cannot reach the peer, and has no peer role or timeline to report. The fence
  // still says serve. Verdict and topology are the view-model's job.
  const drop = new Set(["replication.lagSeconds", "fence.peerRole", "fence.peerTimeline"]);
  const changed: Record<string, { value: Fact["value"]; severity: FactSeverity }> = {
    "replication.state": { value: { type: "string", value: "none" }, severity: "warn" },
    "replication.standbyConnected": { value: { type: "boolean", value: false }, severity: "warn" },
    "replication.peerReachable": { value: { type: "boolean", value: false }, severity: "warn" },
  };
  f.facts = f.facts
    .filter((x) => !drop.has(`${x.group}.${x.key}`))
    .map((x) => {
      const c = changed[`${x.group}.${x.key}`];
      return c ? { ...x, ...c } : x;
    });
  return f;
}

/** Pretty JSON, but any object or array that fits in 100 columns stays on one line. */
function format(value: unknown, indent: string): string {
  const flat = JSON.stringify(value);
  if (value === null || typeof value !== "object" || indent.length + flat.length <= 100) return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => inner + format(v, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`);
  return `{\n${entries.join(",\n")}\n${indent}}`;
}

const outDir = fileURLToPath(new URL("./data/", import.meta.url));
for (const [name, build] of [
  ["default", buildDefault],
  ["stale", buildStale],
  ["incident", buildIncident],
] as const) {
  // Throws (with the Zod issue path) if any entity drifts from the model.
  const fixture = parseFixture(build());
  writeFileSync(`${outDir}${name}.json`, `${format(fixture, "")}\n`);
}
// Let Biome own the final layout so `biome ci` stays green on the generated files.
execFileSync("bunx", ["biome", "format", "--write", outDir], { stdio: "ignore" });
