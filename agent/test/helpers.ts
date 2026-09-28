import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type AgentOptions } from "../src/agent";
import { ResultBuffer } from "../src/buffer";
import { AgentClient } from "../src/client";
import { configureLog } from "../src/log";
import type { CheckResult, CheckTransport, RunCheck } from "../src/shared";
import { KEY, RUNNER } from "./fake-uptellis";

configureLog({ quiet: true });

const dirs: string[] = [];
export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "uptellis-agent-"));
  dirs.push(d);
  return d;
}
export function cleanup(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export const noTransport: CheckTransport = {
  fetch: (() => Promise.reject(new Error("no network in tests"))) as unknown as typeof fetch,
  tcp: () => Promise.reject(new Error("no network in tests")),
};

/** A fake check: `up` with the monitor id in the message, at the injected clock. */
export const fakeRunCheck: RunCheck = async (m, o) => ({
  monitorId: m.id,
  ts: new Date(Math.floor((o.now?.() ?? Date.now()) / 1000) * 1000).toISOString(),
  status: "up",
  latencyMs: 5,
  message: "HTTP 200",
});

export const result = (monitorId: string, ts: number, message = "HTTP 200"): CheckResult => ({
  monitorId,
  ts: new Date(Math.floor(ts / 1000) * 1000).toISOString(),
  status: "up",
  latencyMs: 1,
  message,
});

export function makeAgent(
  url: string,
  dir: string,
  extra: Partial<AgentOptions> & { key?: string; now?: () => number } = {},
): { agent: Agent; buffer: ResultBuffer } {
  const buffer = new ResultBuffer(dir, extra.now ? { now: extra.now } : {});
  const agent = new Agent({
    client: new AgentClient({ baseUrl: url, apiKey: extra.key ?? KEY, runner: RUNNER, timeoutMs: 2000 }),
    buffer,
    runner: RUNNER,
    dataDir: dir,
    runCheck: fakeRunCheck,
    transport: noTransport,
    concurrency: 4,
    random: () => 0.5,
    ...extra,
  });
  return { agent, buffer };
}
