/**
 * The Worker's `scheduled` handler (src/server.ts exports it): runs the cron job for the trigger inside
 * `ctx.waitUntil` (which also carries its Discord cards) and logs one line per run: the job name and counts
 * only (for probes also the number of checks, down results and failed sites; never a response).
 */
import { runCron } from "./cron";

export function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
  ctx.waitUntil(
    runCron(env, controller, ctx).then((r) => {
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
    }),
  );
}
