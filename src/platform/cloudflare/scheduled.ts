/**
 * The Worker's `scheduled` handler (src/server.ts exports it): maps the Cron Trigger to its job in `JOBS`
 * (the triggers in wrangler.jsonc are exactly the `JOBS` expressions) and runs it inside `ctx.waitUntil`,
 * which also carries its Discord cards.
 */
import { runScheduledJob } from "@/worker/scheduled";
import { JOBS, type JobName } from "../types";
import { createCloudflarePlatform } from ".";

/** The job a Cron Trigger expression runs, or null for a trigger that is not in `JOBS`. */
export function jobForCron(cron: string): JobName | null {
  const hit = Object.entries(JOBS).find(([, expr]) => expr === cron);
  return hit ? (hit[0] as JobName) : null;
}

export function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
  const job = jobForCron(controller.cron);
  if (!job) {
    console.warn(JSON.stringify({ evt: "cron", step: "no_job" }));
    return;
  }
  ctx.waitUntil(runScheduledJob(createCloudflarePlatform(env, ctx), job, controller.scheduledTime));
}
