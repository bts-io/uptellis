// The agent: poll the monitors assigned to this runner, run them on the minute, buffer every result on
// disk, and flush the buffer oldest first. Three loops share one `Agent`:
//   poll      GET /monitors every `pollS` (If-None-Match), backing off on failure
//   schedule  wakes at each minute, starts the monitors due then (bounded concurrency)
//   flush     after each minute's checks, every `pollS`, and when a backoff ends
import { writeFileSync } from "node:fs";
import { Backoff, failureKind } from "./backoff";
import type { Entry, ResultBuffer } from "./buffer";
import { type AgentClient, AgentClient as Client } from "./client";
import { log } from "./log";
import { loadMonitors, saveMonitors } from "./monitors-store";
import { epochMinute, isDue, msToNextMinute, Pool, Waker } from "./schedule";
import {
  CheckResult,
  type CheckTransport,
  MAX_RESULTS_BYTES,
  MAX_RESULTS_PER_BATCH,
  type MonitorConfig,
  type RunCheck,
} from "./shared";
import { VERSION } from "./version";

export const DEFAULT_POLL_S = 60;

export interface AgentOptions {
  client: AgentClient;
  buffer: ResultBuffer;
  runner: string;
  dataDir: string;
  runCheck: RunCheck;
  transport: CheckTransport;
  concurrency: number;
  livenessFile?: string | null;
  now?: () => number;
  random?: () => number;
  /** Passed to the checks (tests make the quick retry instant). */
  sleep?: (ms: number) => Promise<void>;
  /** Byte cap per request (tests lower it). */
  maxBatchBytes?: number;
}

export type PollOutcome = "changed" | "unchanged" | "failed";
export type FlushOutcome = "empty" | "backoff" | "auth" | "stopped";

const AUTH_HINT: Record<number, string> = {
  401: "the API key is wrong or revoked",
  403: "the key lacks the agent scope, or this runner id is not in the site's agents",
};

export class Agent {
  monitors: MonitorConfig[] = [];
  pollS = DEFAULT_POLL_S;
  private etag: string | null = null;
  private site: string | null = null;
  private readonly running = new Set<string>();
  private readonly inflight = new Set<Promise<unknown>>();
  private readonly pool: Pool;
  private flushing: Promise<FlushOutcome> | null = null;
  /** The last failed send was a 401 or 403 (the backoff is the long one). */
  private lastFailureAuth = false;
  private readonly now: () => number;
  readonly pollBackoff: Backoff;
  readonly flushBackoff: Backoff;
  private readonly waker = new Waker();
  private readonly flushWaker = new Waker();
  private readonly maxBatchBytes: number;
  /** Results delivered (2xx) and refused (400, or a single result over the byte cap) since start. */
  sent = 0;
  refused = 0;

  constructor(private readonly o: AgentOptions) {
    this.now = o.now ?? Date.now;
    this.pool = new Pool(o.concurrency);
    this.pollBackoff = new Backoff(this.now, o.random);
    this.flushBackoff = new Backoff(this.now, o.random);
    this.maxBatchBytes = o.maxBatchBytes ?? MAX_RESULTS_BYTES;
    const stored = loadMonitors(o.dataDir, o.runner);
    if (stored) {
      this.apply(stored.response.monitors, stored.response.pollS, stored.etag, stored.response.site);
      log("info", "monitors.restored", { monitors: this.monitors.length });
    }
  }

  private apply(monitors: MonitorConfig[], pollS: number, etag: string | null, site: string): void {
    this.monitors = monitors.filter((m) => m.enabled);
    this.pollS = pollS;
    this.etag = etag;
    this.site = site;
  }

  get stopped(): boolean {
    return this.waker.stopped;
  }

  /** One GET of the monitor list. */
  async poll(): Promise<PollOutcome> {
    const r = await this.o.client.fetchMonitors(this.etag);
    if (r.kind === "unchanged") {
      this.pollBackoff.reset();
      log("debug", "monitors.unchanged", { monitors: this.monitors.length });
      return "unchanged";
    }
    if (r.kind === "changed") {
      if (r.body.runner !== this.o.runner) {
        log("error", "monitors.wrong_runner", { expected: this.o.runner });
        this.pollBackoff.fail("transient");
        return "failed";
      }
      this.pollBackoff.reset();
      this.apply(r.body.monitors, r.body.pollS, r.etag, r.body.site);
      try {
        saveMonitors(this.o.dataDir, { etag: r.etag, response: r.body });
      } catch (e) {
        log("warn", "monitors.save_failed", { error: (e as NodeJS.ErrnoException).code ?? "unknown" });
      }
      log("info", "monitors.updated", {
        site: r.body.site,
        monitors: this.monitors.length,
        pollS: this.pollS,
      });
      return "changed";
    }
    const kind = failureKind(r.status);
    const delayMs = this.pollBackoff.fail(kind, r.retryAfterMs);
    const fields = {
      status: r.status,
      failures: this.pollBackoff.failures,
      retryInS: Math.round(delayMs / 1000),
    };
    if (kind === "auth") log("error", "monitors.auth_failed", { ...fields, hint: AUTH_HINT[r.status] });
    else if (r.invalid) log("error", "monitors.invalid_response", fields);
    else log("warn", "monitors.failed", fields);
    return "failed";
  }

  /** Runs one monitor (never throws) and buffers a valid result. */
  private async check(m: MonitorConfig): Promise<void> {
    this.running.add(m.id);
    try {
      let result: CheckResult;
      try {
        result = await this.pool.run(() =>
          this.o.runCheck(m, {
            transport: this.o.transport,
            version: VERSION,
            now: this.now,
            ...(this.o.sleep ? { sleep: this.o.sleep } : {}),
          }),
        );
      } catch {
        // runCheck never throws by contract; a bug must not stop the others.
        log("error", "check.threw", { monitor: m.id });
        return;
      }
      const parsed = CheckResult.safeParse(result);
      if (!parsed.success || parsed.data.monitorId !== m.id) {
        log("error", "check.invalid_result", { monitor: m.id });
        return;
      }
      this.o.buffer.append([parsed.data]);
      log("debug", "check.done", { monitor: m.id, status: parsed.data.status });
    } finally {
      this.running.delete(m.id);
    }
  }

  /** Starts the monitors due on `minute` (skipping any still running); resolves when they finished. */
  tick(minute: number): Promise<void> {
    return this.runMonitors(this.monitors.filter((m) => isDue(m, minute)));
  }

  /** Starts every monitor now, whatever its interval (`--once`). */
  runAll(): Promise<void> {
    return this.runMonitors(this.monitors);
  }

  private runMonitors(list: MonitorConfig[]): Promise<void> {
    const started: Promise<void>[] = [];
    for (const m of list) {
      if (this.running.has(m.id)) {
        log("warn", "check.overrun", { monitor: m.id });
        continue;
      }
      const p = this.check(m);
      this.track(p);
      started.push(p);
    }
    return Promise.all(started).then(() => undefined);
  }

  private track(p: Promise<unknown>): void {
    this.inflight.add(p);
    p.finally(() => this.inflight.delete(p));
  }

  /** Sends the buffer oldest first until it is empty or a request fails. One flush runs at a time. */
  flush(opts: { force?: boolean } = {}): Promise<FlushOutcome> {
    if (!this.flushing) {
      this.flushing = this.drain(opts.force ?? false).finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async drain(force: boolean): Promise<FlushOutcome> {
    let limit = MAX_RESULTS_PER_BATCH;
    for (;;) {
      if (this.o.buffer.size === 0) return "empty";
      if (!force && this.flushBackoff.remaining() > 0) return this.lastFailureAuth ? "auth" : "backoff";
      const { entries, body } = this.batch(limit);
      const last = entries.at(-1)!;
      const r = await this.o.client.postResults(body);
      if (r.kind === "accepted") {
        this.o.buffer.drop(last.seq);
        this.flushBackoff.reset();
        this.lastFailureAuth = false;
        this.sent += entries.length;
        log("info", "results.sent", {
          status: r.status,
          results: entries.length,
          accepted: r.accepted?.accepted,
          ignored: r.accepted?.ignored,
          pending: this.o.buffer.size,
        });
        continue;
      }
      if (r.status === 400) {
        // The instance refuses the body itself: resending it would never succeed.
        this.o.buffer.drop(last.seq);
        this.refused += entries.length;
        log("error", "results.rejected", {
          status: 400,
          results: entries.length,
          pending: this.o.buffer.size,
        });
        continue;
      }
      if (r.status === 413) {
        if (entries.length > 1) {
          limit = Math.ceil(entries.length / 2);
          log("warn", "results.too_large", { results: entries.length, retryWith: limit });
          continue;
        }
        this.o.buffer.drop(last.seq);
        this.refused++;
        log("error", "results.result_too_large", { monitor: last.result.monitorId });
        continue;
      }
      const kind = failureKind(r.status);
      const delayMs = this.flushBackoff.fail(kind, r.retryAfterMs);
      this.lastFailureAuth = kind === "auth";
      const fields = {
        status: r.status,
        failures: this.flushBackoff.failures,
        pending: this.o.buffer.size,
        retryInS: Math.round(delayMs / 1000),
      };
      if (kind === "auth") {
        log("error", "results.auth_failed", { ...fields, hint: AUTH_HINT[r.status] });
        return "auth";
      }
      log("warn", "results.failed", fields);
      return "backoff";
    }
  }

  /** The oldest results that fit one request: at most `limit` of them and the byte cap. */
  private batch(limit: number): { entries: Entry[]; body: string } {
    const sentAt = new Date(this.now());
    const envelope = Buffer.byteLength(Client.body([], sentAt));
    const candidates = this.o.buffer.peek(Math.min(limit, MAX_RESULTS_PER_BATCH));
    let bytes = envelope;
    let n = 0;
    for (const e of candidates) {
      const next = bytes + e.bytes + (n > 0 ? 1 : 0);
      if (n > 0 && next > this.maxBatchBytes) break;
      bytes = next;
      n++;
    }
    let entries = candidates.slice(0, n);
    let body = Client.body(
      entries.map((e) => e.result),
      sentAt,
    );
    while (entries.length > 1 && Buffer.byteLength(body) > this.maxBatchBytes) {
      entries = entries.slice(0, Math.ceil(entries.length / 2));
      body = Client.body(
        entries.map((e) => e.result),
        sentAt,
      );
    }
    return { entries, body };
  }

  private touchLiveness(): void {
    if (!this.o.livenessFile) return;
    try {
      writeFileSync(this.o.livenessFile, `${this.now()}\n`);
    } catch {
      // Liveness is advisory (the image healthcheck); never let it stop a tick.
    }
  }

  /** Runs until `stop()`: the poll, schedule and flush loops. */
  async run(): Promise<void> {
    log("info", "agent.running", { runner: this.o.runner, monitors: this.monitors.length, site: this.site });
    await Promise.all([this.pollLoop(), this.scheduleLoop(), this.flushLoop()]);
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped) {
      await this.poll();
      const wait = this.pollBackoff.failures > 0 ? this.pollBackoff.remaining() : this.pollS * 1000;
      await this.waker.wait(wait);
    }
  }

  private async scheduleLoop(): Promise<void> {
    let lastMinute = epochMinute(this.now());
    while (!this.stopped) {
      await this.waker.wait(msToNextMinute(this.now()) + 5);
      if (this.stopped) break;
      const minute = epochMinute(this.now());
      if (minute === lastMinute) continue;
      lastMinute = minute;
      this.touchLiveness();
      const done = this.tick(minute);
      this.track(done.then(() => this.flushWaker.wake()));
    }
  }

  private async flushLoop(): Promise<void> {
    while (!this.stopped) {
      await this.flush();
      if (this.stopped) break;
      const backoff = this.o.buffer.size > 0 ? this.flushBackoff.remaining() : 0;
      await this.flushWaker.wait(backoff > 0 ? backoff : this.pollS * 1000);
    }
  }

  /** Stops the loops, waits up to `graceMs` for running checks, then tries one last flush. */
  async stop(graceMs = 10_000): Promise<FlushOutcome> {
    this.waker.stop();
    this.flushWaker.stop();
    await Promise.race([Promise.allSettled([...this.inflight]), Bun.sleep(graceMs)]);
    await this.flushing?.catch(() => undefined);
    const outcome = this.lastFailureAuth ? "auth" : await this.flush({ force: true });
    log("info", "agent.stopped", { pending: this.o.buffer.size, flush: outcome });
    return outcome;
  }
}
