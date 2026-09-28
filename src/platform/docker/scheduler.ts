/**
 * Docker's own scheduler for `JOBS` (Cloudflare uses Cron Triggers instead). It wakes at the start of
 * every UTC minute and starts each job whose expression matches that minute, with the minute as its
 * scheduled time. A job still running from an earlier minute is skipped, never run twice at once; a
 * failure is logged by the job's and the error's names only.
 */
import { JOBS, type JobName } from "../types";

const MINUTE_MS = 60_000;

/** The five cron fields and their ranges: minute, hour, day of month, month, day of week (0 or 7 is Sunday). */
const FIELDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 },
] as const;

/** The values one cron field allows: `*`, `n`, `a-b`, any of those with `/step`, and comma lists. */
function fieldValues(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`Invalid cron field: ${field}`);
    const from = m[1] === "*" ? min : Number(m[2]);
    const to = m[1] === "*" ? max : m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? max : from;
    const step = m[4] !== undefined ? Number(m[4]) : 1;
    if (from < min || to > max || from > to || step < 1) throw new Error(`Invalid cron field: ${field}`);
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

/** True when the 5-field cron expression `expr` fires in the UTC minute that contains `ms`. */
export function cronMatches(expr: string, ms: number): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${expr}`);
  const [minute, hour, dom, month, dow] = parts.map((p, i) => fieldValues(p, FIELDS[i]!.min, FIELDS[i]!.max));
  const d = new Date(ms);
  const weekday = d.getUTCDay();
  const domAny = parts[2] === "*";
  const dowAny = parts[4] === "*";
  const dowHit = dow!.has(weekday) || (weekday === 0 && dow!.has(7));
  // Standard cron: when both day fields are restricted, either one matching is enough.
  const dayHit = domAny || dowAny ? dom!.has(d.getUTCDate()) && dowHit : dom!.has(d.getUTCDate()) || dowHit;
  return (
    minute!.has(d.getUTCMinutes()) && hour!.has(d.getUTCHours()) && month!.has(d.getUTCMonth() + 1) && dayHit
  );
}

/** The jobs due in the minute that contains `ms`, in `JOBS` order. */
export const dueJobs = (ms: number): JobName[] =>
  (Object.keys(JOBS) as JobName[]).filter((job) => cronMatches(JOBS[job], ms));

export type RunJob = (job: JobName, scheduledTime: number) => Promise<void>;

export interface SchedulerOptions {
  /** Wall clock in epoch milliseconds. */
  now?: () => number;
}

export interface Scheduler {
  /** Starts the due jobs of the minute that contains `ms` (the timer calls this; tests call it directly). */
  tick(ms: number): void;
  /** Stops the timer and waits for the running jobs. */
  stop(): Promise<void>;
}

/** Starts the minute-aligned timer; `run` performs a job (`runScheduledJob` over the platform). */
export function startScheduler(run: RunJob, opts: SchedulerOptions = {}): Scheduler {
  const now = opts.now ?? (() => Date.now());
  const running = new Map<JobName, Promise<void>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const tick = (ms: number) => {
    const scheduledTime = Math.floor(ms / MINUTE_MS) * MINUTE_MS;
    for (const job of dueJobs(scheduledTime)) {
      if (running.has(job)) {
        console.warn(JSON.stringify({ evt: "scheduler", job, step: "skipped_overlap" }));
        continue;
      }
      const p = run(job, scheduledTime)
        .catch((err: unknown) =>
          console.error(
            JSON.stringify({
              evt: "scheduler",
              job,
              step: "failed",
              name: err instanceof Error ? err.name : "unknown",
            }),
          ),
        )
        .finally(() => running.delete(job));
      running.set(job, p);
    }
  };

  const arm = () => {
    if (stopped) return;
    const t = now();
    timer = setTimeout(
      () => {
        tick(now());
        arm();
      },
      MINUTE_MS - (t % MINUTE_MS),
    );
  };
  arm();

  return {
    tick,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await Promise.allSettled([...running.values()]);
    },
  };
}
