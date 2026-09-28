/**
 * One scheduled run as both runtimes perform it: the job (./cron.ts) and one log line with its name and
 * counts only (for probes also the number of checks, down results and failed sites; never a response).
 * A failure propagates to the caller (the Workers runtime, or the Docker scheduler, which logs its name).
 */
import type { JobName, Platform } from "@/platform/types";
import { runJob } from "./cron";

export async function runScheduledJob(
  platform: Platform,
  job: JobName,
  scheduledTime: number,
): Promise<void> {
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
}
