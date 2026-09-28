#!/usr/bin/env bun
// Uptellis agent. Usage:
//   uptellis-agent           run forever: poll the monitors, run them on the minute, flush the results
//   uptellis-agent --once    poll, run every monitor once, flush, exit (0 when the buffer is empty)
//   uptellis-agent --version
import { Agent } from "./agent";
import { ResultBuffer } from "./buffer";
import { defaultRunCheck, defaultTransport } from "./checks";
import { AgentClient } from "./client";
import { loadConfig } from "./config";
import { configureLog, log } from "./log";
import { AGENT_NAME } from "./version";

interface Args {
  once: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { once: false };
  for (const v of argv) {
    if (v === "--once") a.once = true;
    else if (v === "--version") {
      process.stdout.write(`${AGENT_NAME}\n`);
      process.exit(0);
    } else if (v === "--help" || v === "-h") {
      process.stdout.write("usage: uptellis-agent [--once] [--version]\n");
      process.exit(0);
    } else throw new Error(`unknown argument ${v}`);
  }
  return a;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  configureLog({ debug: process.env.LOG_LEVEL === "debug" });
  const cfg = loadConfig(process.env);
  const buffer = new ResultBuffer(cfg.dataDir);
  const agent = new Agent({
    client: new AgentClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, runner: cfg.runner }),
    buffer,
    runner: cfg.runner,
    dataDir: cfg.dataDir,
    runCheck: defaultRunCheck,
    transport: defaultTransport,
    concurrency: cfg.concurrency,
    livenessFile: cfg.livenessFile,
  });
  log("info", "agent.start", {
    agent: AGENT_NAME,
    runner: cfg.runner,
    once: args.once,
    pending: buffer.size,
    concurrency: cfg.concurrency,
  });

  try {
    if (args.once) {
      const polled = await agent.poll();
      if (polled === "failed" && agent.monitors.length === 0 && buffer.size === 0) return 1;
      await agent.runAll();
      const flushed = await agent.flush({ force: true });
      log("info", "agent.once", { flush: flushed, sent: agent.sent, pending: buffer.size });
      return flushed === "empty" && polled !== "failed" ? 0 : 1;
    }

    let stopping: Promise<unknown> | null = null;
    const stop = (signal: string) => {
      if (stopping) return;
      log("info", "agent.stopping", { signal });
      stopping = agent.stop();
    };
    process.on("SIGTERM", () => stop("SIGTERM"));
    process.on("SIGINT", () => stop("SIGINT"));
    await agent.run();
    await stopping;
    return 0;
  } finally {
    buffer.close();
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    log("error", "agent.fatal", { error: e instanceof Error ? e.message : "unknown" });
    process.exit(2);
  },
);
