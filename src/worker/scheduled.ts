/**
 * One scheduled run as both runtimes perform it: the job (./cron.ts) and one log line with its name and
 * counts only (for the builtin monitor runner also the sites and checks it ran, the checks that were down
 * and the sites that failed, and the push monitors the silent rule marked down; never a response). A failure propagates to the caller (the Workers runtime, or the Docker scheduler, which logs its name).
 */
import type { JobName, Platform } from "@/platform/types";
import { runJob } from "./cron";

export async function runScheduledJob(
  platform: Platform,
  job: JobName,
  scheduledTime: number,
): Promise<void> {
  const r = await runJob(platform, job, scheduledTime);
  const push = r.push ?? { down: 0, opened: [], resolved: [], failedSites: 0 };
  console.log(
    JSON.stringify({
      evt: "cron",
      job: r.job,
      opened: r.opened?.length ?? 0,
      resolved: r.resolved?.length ?? 0,
      ...(r.probes && {
        opened: r.probes.opened.length + push.opened.length,
        resolved: r.probes.resolved.length + push.resolved.length,
        sites: r.probes.sites,
        checks: r.probes.checks,
        down: r.probes.down,
        silent: push.down,
        failedSites: r.probes.failedSites + push.failedSites,
      }),
    }),
  );
}
