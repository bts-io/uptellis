// The tick: refresh from Kuma, build, guard, then send (or print). Heartbeats leave the buffer only when
// the Worker acknowledged the POST that carried them.
import { writeFileSync } from "node:fs";
import type { HostAliases } from "./address";
import type { BeatBuffer } from "./buffer";
import type { IngestConfig } from "./config";
import { log } from "./log";
import { type FetchLike, postSnapshot } from "./sender";
import type { KumaSession } from "./session";
import { INGEST_LIMITS, type KumaSnapshot } from "./shared";
import { buildSnapshot, guardSnapshot } from "./snapshot";
import type { KumaState } from "./state";

/** Stays under the Worker's 256 KB body cap. */
export const MAX_BODY_BYTES = 240 * 1024;

export interface CollectorOptions {
  state: KumaState;
  session: Pick<KumaSession, "refresh" | "status">;
  host: string;
  aliases: HostAliases;
  buffer: BeatBuffer;
  /** Null: dry run (print to `out` instead of sending). */
  ingest: IngestConfig | null;
  /** Where --dry-run prints; awaited so the whole snapshot reaches a pipe before the process exits. */
  out?: (json: string) => unknown;
  fetchImpl?: FetchLike;
  livenessFile?: string | null;
}

export type TickResult =
  | { kind: "sent"; beats: number; bytes: number }
  | { kind: "printed"; snapshot: KumaSnapshot }
  | { kind: "refused" }
  | { kind: "failed"; status: number };

export function wireBuffer(state: KumaState, buffer: BeatBuffer): void {
  state.onBeat = (b) => buffer.add(b);
}

export class Collector {
  sendFailures = 0;

  constructor(private readonly o: CollectorOptions) {}

  /** Builds a guarded snapshot and its body, shrinking the heartbeat batch until the body fits. */
  prepare(now = new Date()): { snapshot: KumaSnapshot; body: string; beats: number } | null {
    const { reachable, error } = this.o.session.status();
    let limit: number = INGEST_LIMITS.heartbeats;
    for (;;) {
      const beats = this.o.buffer.take(limit, now.getTime());
      const snap = buildSnapshot(this.o.state, now, {
        host: this.o.host,
        aliases: this.o.aliases,
        beats,
        reachable,
        error,
      });
      const g = guardSnapshot(snap);
      if (!g.ok) {
        // Fail closed. Paths and schema codes only; the values may be exactly what must not leak.
        log("error", "snapshot.refused", {
          literalPaths: g.literalPaths,
          schemaIssues: g.schemaIssues.slice(0, 20),
        });
        return null;
      }
      const body = JSON.stringify(g.snapshot);
      if (Buffer.byteLength(body) <= MAX_BODY_BYTES || limit === 0) {
        return { snapshot: g.snapshot, body, beats: g.snapshot.heartbeatsSince.length };
      }
      limit = Math.floor(limit / 2);
    }
  }

  async tick(): Promise<TickResult> {
    await this.o.session.refresh().catch(() => undefined);
    const prepared = this.prepare();
    this.touchLiveness();
    if (!prepared) return { kind: "refused" };
    const { snapshot, body, beats } = prepared;
    const sent = snapshot.heartbeatsSince.map((b) => ({ ...b, important: b.important ?? false }));
    if (!this.o.ingest) {
      await (this.o.out ?? ((s) => Bun.write(Bun.stdout, `${s}\n`)))(JSON.stringify(snapshot, null, 2));
      this.o.buffer.ack(sent);
      return { kind: "printed", snapshot };
    }
    const res = await postSnapshot(this.o.ingest, body, this.o.fetchImpl);
    if (res.ok) {
      this.o.buffer.ack(sent);
      this.sendFailures = 0;
      log("info", "ingest.sent", {
        status: res.status,
        monitors: snapshot.monitors.length,
        beats,
        pending: this.o.buffer.size,
        bytes: body.length,
        reachable: snapshot.reachable,
      });
      return { kind: "sent", beats, bytes: body.length };
    }
    this.sendFailures++;
    log("warn", "ingest.failed", {
      status: res.status,
      failures: this.sendFailures,
      pending: this.o.buffer.size,
    });
    return { kind: "failed", status: res.status };
  }

  /** Delay before the next tick: the interval, or a jittered backoff (5 s doubling) after a failed send. */
  nextDelayMs(intervalS: number): number {
    if (this.sendFailures === 0) return intervalS * 1000;
    const backoff = Math.min(intervalS, 5 * 2 ** (this.sendFailures - 1)) * 1000;
    return Math.round(backoff * (0.75 + Math.random() * 0.5));
  }

  private touchLiveness(): void {
    if (!this.o.livenessFile) return;
    try {
      writeFileSync(this.o.livenessFile, `${Date.now()}\n`);
    } catch {
      // Liveness is advisory (healthcheck); never let it stop a tick.
    }
  }
}
