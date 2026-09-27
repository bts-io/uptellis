// Unsent heartbeats. Every beat Kuma reports lands here once; a snapshot carries the oldest pending
// ones; an acknowledged POST removes exactly what it carried and moves the per-monitor watermark, so a
// beat at or before the watermark (Kuma resends the last 100 on every login) is never queued again.
// When the Worker is unreachable the buffer keeps the last `windowMs` (60 minutes) and drops older beats.
import type { Beat } from "./state";

const key = (b: Beat) => `${b.monitorId}|${b.ts}`;

export class BeatBuffer {
  private pending = new Map<string, Beat>();
  /** Per monitor: ts of the newest acknowledged beat. */
  private acked = new Map<number, string>();
  dropped = 0;

  constructor(
    readonly windowMs = 60 * 60 * 1000,
    readonly maxBeats = 20_000,
  ) {}

  add(b: Beat, now = Date.now()): void {
    const wm = this.acked.get(b.monitorId);
    if (wm && b.ts <= wm) return;
    if (Date.parse(b.ts) < now - this.windowMs) return;
    this.pending.set(key(b), b);
    if (this.pending.size > this.maxBeats) this.prune(now);
  }

  /** Drops beats older than the window, then the oldest beyond `maxBeats`. */
  prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [k, b] of this.pending) {
      if (Date.parse(b.ts) < cutoff) {
        this.pending.delete(k);
        this.dropped++;
      }
    }
    if (this.pending.size > this.maxBeats) {
      const extra = this.sorted().slice(0, this.pending.size - this.maxBeats);
      for (const b of extra) {
        this.pending.delete(key(b));
        this.dropped++;
      }
    }
  }

  private sorted(): Beat[] {
    return [...this.pending.values()].sort((a, b) =>
      a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.monitorId - b.monitorId,
    );
  }

  /** The oldest `limit` pending beats, oldest first (so a backlog flushes in order). */
  take(limit: number, now = Date.now()): Beat[] {
    this.prune(now);
    return this.sorted().slice(0, limit);
  }

  /** Marks beats as delivered. */
  ack(beats: readonly Beat[]): void {
    for (const b of beats) {
      this.pending.delete(key(b));
      const wm = this.acked.get(b.monitorId);
      if (!wm || b.ts > wm) this.acked.set(b.monitorId, b.ts);
    }
    // Anything older than a watermark is now redundant (the Worker has newer data for that monitor).
    for (const [k, b] of this.pending) {
      const wm = this.acked.get(b.monitorId);
      if (wm && b.ts <= wm) this.pending.delete(k);
    }
  }

  get size(): number {
    return this.pending.size;
  }

  watermark(monitorId: number): string | undefined {
    return this.acked.get(monitorId);
  }
}
