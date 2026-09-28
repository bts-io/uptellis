// Scheduling, aligned to the minute like the instance's builtin runner: a monitor runs on the minutes where
// floor(epoch minutes) % (intervalS / 60) == 0, so every runner of a monitor checks at the same moments.
import type { MonitorConfig } from "./shared";

export const epochMinute = (ms: number) => Math.floor(ms / 60_000);

export const isDue = (m: Pick<MonitorConfig, "intervalS" | "enabled">, minute: number) =>
  m.enabled && minute % Math.max(1, Math.round(m.intervalS / 60)) === 0;

/** Ms from `ms` to the start of the next minute (always > 0). */
export const msToNextMinute = (ms: number) => 60_000 - (((ms % 60_000) + 60_000) % 60_000);

/** Runs at most `limit` tasks at a time, in the order they were queued. */
export class Pool {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  get pending(): number {
    return this.active + this.queue.length;
  }
}

/** A sleep that `wake()` or `stop()` ends early. */
export class Waker {
  private waiters = new Set<() => void>();
  stopped = false;

  wait(ms: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, ms));
      this.waiters.add(done);
    });
  }

  wake(): void {
    for (const w of [...this.waiters]) w();
  }

  stop(): void {
    this.stopped = true;
    this.wake();
  }
}
