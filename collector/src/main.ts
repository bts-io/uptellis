#!/usr/bin/env bun
// Uptellis Kuma collector. Usage:
//   bun src/main.ts                 run forever: one snapshot every INTERVAL_S (60 s), signed POST
//   bun src/main.ts --once          one snapshot, then exit (non-zero if it was not delivered)
//   bun src/main.ts --dry-run       print snapshots as JSON on stdout instead of sending
//   bun src/main.ts --record PATH   wait for Kuma state, write one scrubbed snapshot to PATH, exit
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BeatBuffer } from "./buffer";
import { Collector, wireBuffer } from "./collector";
import { loadConfig } from "./config";
import { configureLog, log } from "./log";
import { KumaSession } from "./session";
import { createState } from "./state";

interface Args {
  dryRun: boolean;
  once: boolean;
  record: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, once: false, record: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--dry-run") a.dryRun = true;
    else if (v === "--once") a.once = true;
    else if (v === "--record") {
      a.record = argv[++i] ?? null;
      if (!a.record) throw new Error("--record needs a path");
    } else if (v === "--help" || v === "-h") {
      process.stdout.write("usage: collector [--dry-run] [--once] [--record PATH]\n");
      process.exit(0);
    } else throw new Error(`unknown argument ${v}`);
  }
  return a;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  configureLog({ debug: process.env.LOG_LEVEL === "debug" });
  const offline = args.dryRun || args.record !== null;
  const cfg = loadConfig(process.env, { needIngest: !offline });

  const state = createState();
  const buffer = new BeatBuffer(cfg.bufferWindowMin * 60_000);
  wireBuffer(state, buffer);
  const session = new KumaSession({
    url: cfg.kumaUrl,
    username: cfg.kumaUsername,
    password: cfg.kumaPassword,
    state,
  });
  let recorded: string | null = null;
  const collector = new Collector({
    state,
    session,
    host: cfg.host,
    aliases: cfg.aliases,
    buffer,
    ingest: offline ? null : cfg.ingest,
    livenessFile: args.record ? null : cfg.livenessFile,
    out: args.record ? (json) => (recorded = json) : undefined,
  });

  let stopping = false;
  const stop = () => {
    stopping = true;
    session.stop();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  log("info", "collector.start", {
    host: cfg.host,
    mode: args.record ? "record" : args.dryRun ? "dry-run" : "send",
    once: args.once || !!args.record,
    aliases: cfg.aliases.size,
  });
  session.start();

  // Let the login burst (monitorList, heartbeatList, stats) land before the first snapshot.
  try {
    await session.waitReady(args.record ? 60_000 : 30_000);
    await session.waitQuiet(1_500, 20_000);
  } catch (e) {
    if (args.record) {
      log("error", "record.kuma_not_ready", { error: (e as Error).message });
      stop();
      return 1;
    }
    log("warn", "kuma.not_ready", { error: (e as Error).message });
  }

  if (args.once || args.record) {
    const r = await collector.tick();
    stop();
    if (args.record) {
      if (r.kind !== "printed" || recorded === null) return 1;
      const path = resolve(args.record);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${recorded}\n`);
      log("info", "record.written", {
        monitors: r.snapshot.monitors.length,
        heartbeats: r.snapshot.heartbeatsSince.length,
        important: r.snapshot.importantHeartbeats.length,
      });
      return 0;
    }
    return r.kind === "sent" || r.kind === "printed" ? 0 : 1;
  }

  while (!stopping) {
    await collector.tick();
    const delay = collector.nextDelayMs(cfg.intervalS);
    const until = Date.now() + delay;
    while (!stopping && Date.now() < until) await Bun.sleep(Math.min(500, until - Date.now()));
  }
  log("info", "collector.stopped");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    log("error", "collector.fatal", { error: e instanceof Error ? e.message : "unknown" });
    process.exit(2);
  },
);
