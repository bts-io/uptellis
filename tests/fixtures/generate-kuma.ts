// Regenerates tests/fixtures/data/kuma-recorded.json: a synthetic Kuma snapshot for the demo site
// (sites/demo.json), in exactly the format `bun run record` in collector/ writes (a guarded `KumaSnapshot`
// with the last 60 minutes of beats). Nothing in it was recorded: names, hosts, timings and latencies are
// made up, and a seeded generator keeps the output stable. The snapshot is parsed through the shared Zod
// schema before it is written.
// Run: bun tests/fixtures/generate-kuma.ts
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import { KumaSnapshot } from "../../src/shared/schemas";

type Snapshot = z.input<typeof KumaSnapshot>;
type Beat = Snapshot["heartbeatsSince"][number];
type Monitor = Snapshot["monitors"][number];

const GENERATED_AT = Date.parse("2026-09-27T03:00:00.000Z");
const WINDOW_S = 60 * 60;
const CERT_VALID_TO = "2026-12-10T08:12:00.000Z";

interface Spec {
  monitor: Monitor;
  /** Typical latency and its spread, in ms. */
  pingMs: number;
  jitterMs: number;
  /** How a beat's message reads, given its latency. */
  msg: (ms: number) => string;
  /** Integer latencies (port, http) or two decimals (ping). */
  decimals: number;
  uptime: number;
  cert: boolean;
}

const http = (id: number, name: string, url: string, intervalS: number): Monitor => ({
  id,
  name,
  type: "http",
  url,
  hostname: null,
  port: null,
  method: "GET",
  intervalS,
  timeoutS: null,
  active: true,
});

const hostMonitor = (
  id: number,
  name: string,
  type: "port" | "ping",
  hostname: string,
  port: number | null,
) => ({
  id,
  name,
  type,
  url: null,
  hostname,
  port,
  method: null,
  intervalS: type === "port" && port === 5432 ? 30 : 60,
  timeoutS: null,
  active: true,
});

const ok = () => "200 - OK";
const ms = (v: number) => `${Math.round(v)} ms`;
const blank = () => "";

// Monitor 7 is missing on purpose: the demo Kuma deleted one monitor, so the ids have a gap.
const SPECS: Spec[] = [
  {
    monitor: http(1, "API health", "https://example.com/api/healthz", 30),
    pingMs: 180,
    jitterMs: 40,
    msg: ok,
    decimals: 0,
    uptime: 0.9965,
    cert: true,
  },
  {
    monitor: http(2, "Web app", "https://example.com", 60),
    pingMs: 310,
    jitterMs: 60,
    msg: ok,
    decimals: 0,
    uptime: 0.9931,
    cert: true,
  },
  {
    monitor: hostMonitor(3, "Primary - Postgres", "port", "app-1", 5432),
    pingMs: 24,
    jitterMs: 2,
    msg: ms,
    decimals: 0,
    uptime: 0.9979,
    cert: false,
  },
  {
    monitor: hostMonitor(4, "Primary - SSH", "port", "app-1", 22),
    pingMs: 24,
    jitterMs: 2,
    msg: ms,
    decimals: 0,
    uptime: 0.9979,
    cert: false,
  },
  {
    monitor: hostMonitor(5, "Replica - Postgres", "port", "app-2", 5432),
    pingMs: 96,
    jitterMs: 3,
    msg: ms,
    decimals: 0,
    uptime: 0.9986,
    cert: false,
  },
  {
    monitor: hostMonitor(6, "Replica - SSH", "port", "app-2", 22),
    pingMs: 96,
    jitterMs: 3,
    msg: ms,
    decimals: 0,
    uptime: 1,
    cert: false,
  },
  {
    monitor: hostMonitor(8, "Runner - Ping", "ping", "runner-1", null),
    pingMs: 1.6,
    jitterMs: 0.6,
    msg: blank,
    decimals: 2,
    uptime: 1,
    cert: false,
  },
  {
    monitor: hostMonitor(9, "Runner - SSH", "port", "runner-1", 22),
    pingMs: 2,
    jitterMs: 1,
    msg: ms,
    decimals: 0,
    uptime: 1,
    cert: false,
  },
];

/** mulberry32: a small seeded PRNG, so the fixture only changes when this file does. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = prng(20260927);
const round = (v: number, decimals: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;
const iso = (t: number) => new Date(t).toISOString();

function latency(s: Spec): number {
  return Math.max(s.decimals ? 0.1 : 1, round(s.pingMs + (rand() * 2 - 1) * s.jitterMs, s.decimals));
}

/** Every beat of the window: one per interval per monitor, staggered like Kuma's schedulers. */
function beatsSince(): Beat[] {
  const beats: Beat[] = [];
  for (const [i, s] of SPECS.entries()) {
    const step = s.monitor.intervalS * 1000;
    const offset = 8_000 + i * 700 + Math.floor(rand() * 500);
    for (let t = GENERATED_AT - WINDOW_S * 1000 + offset; t < GENERATED_AT; t += step) {
      const pingMs = latency(s);
      beats.push({ monitorId: s.monitor.id, ts: iso(t), status: 1, pingMs, msg: s.msg(pingMs) });
    }
  }
  return beats.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.monitorId - b.monitorId);
}

/** The last important beat of each monitor: when Kuma first saw it up, hours before the window. */
function importantBeats(): Beat[] {
  return SPECS.map((s, i) => {
    const pingMs = latency(s);
    return {
      monitorId: s.monitor.id,
      ts: iso(GENERATED_AT - (7 + (i % 3)) * 3_600_000 + i * 20),
      status: 1,
      pingMs,
      msg: s.msg(pingMs),
      important: true,
    };
  });
}

function build(): Snapshot {
  const since = beatsSince();
  const byId = <T>(f: (s: Spec) => T) => Object.fromEntries(SPECS.map((s) => [String(s.monitor.id), f(s)]));
  const avg = (s: Spec) => {
    const own = since.filter((b) => b.monitorId === s.monitor.id).map((b) => b.pingMs ?? 0);
    return round(own.reduce((a, b) => a + b, 0) / own.length, 2);
  };
  const daysRemaining = Math.floor((Date.parse(CERT_VALID_TO) - GENERATED_AT) / 86_400_000);
  return {
    v: 1,
    generatedAt: iso(GENERATED_AT),
    host: "watch-1",
    reachable: true,
    kuma: { version: "2.5.5", latestVersion: "2.5.5", dbSizeBytes: 917504, timezone: "Asia/Tokyo (+09:00)" },
    monitors: SPECS.map((s) => s.monitor),
    heartbeatsSince: since,
    importantHeartbeats: importantBeats(),
    uptime: byId((s) => ({ h24: s.uptime, d30: s.uptime })),
    avgPing: byId(avg),
    certInfo: Object.fromEntries(
      SPECS.filter((s) => s.cert).map((s) => [
        String(s.monitor.id),
        { valid: true, cn: "example.com", issuer: "Example CA", validTo: CERT_VALID_TO, daysRemaining },
      ]),
    ),
  };
}

const out = fileURLToPath(new URL("./data/kuma-recorded.json", import.meta.url));
const snapshot = build();
// Throws (with the Zod issue path) if the snapshot drifts from the ingest schema.
KumaSnapshot.parse(snapshot);
writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
execFileSync("bunx", ["biome", "format", "--write", out], { stdio: "ignore" });
