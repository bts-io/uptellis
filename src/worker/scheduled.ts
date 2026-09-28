/**
 * One scheduled run as both runtimes perform it: the job (./cron.ts) and one log line with its name and
 * counts only (for probes also the number of checks, down results and failed sites; never a response).
 * An error is logged by the job's and the error's names and rethrown.
 */
import type { JobName, Platform } from "@/platform/types";
import { runJob } from "./cron";

export async function runScheduledJob(
  platform: Platform,
  job: JobName,
  scheduledTime: number,
): Promise<void> {
  try {
    const r = await runJob(platform, job, scheduledTime);
    console.log(
      JSON.stringify({
        evt: "cron",
        job: r.job,
        opened: r.opened?.length ?? 0,
        resolved: r.resolved?.length ?? 0,
        ...(r.probes && {
          opened: r.probes.opened.length,
          resolved: r.probes.resolved.length,
          sites: r.probes.sites,
          checks: r.probes.checks,
          down: r.probes.down,
          failedSites: r.probes.failedSites,
        }),
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({ evt: "cron", job, step: "failed", name: err instanceof Error ? err.name : "unknown" }),
    );
    throw err;
  }
}
