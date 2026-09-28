import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { jobForCron, scheduled } from "@/platform/cloudflare/scheduled";
import { JOBS } from "@/platform/types";
import { workerEnv } from "../support/platform";

// The handler src/server.ts exports as `scheduled`, driven the way the runtime drives it.
afterEach(() => vi.restoreAllMocks());

describe("scheduled handler", () => {
  it("runs the job for each wrangler.jsonc trigger inside waitUntil and logs counts only", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    for (const cron of [JOBS.fiveMinute, JOBS.daily]) {
      const ctx = createExecutionContext();
      scheduled(
        createScheduledController({ cron, scheduledTime: Date.parse("2026-09-28T00:00:00Z") }),
        workerEnv,
        ctx,
      );
      await waitOnExecutionContext(ctx);
    }
    expect(logs.map((l) => JSON.parse(l))).toEqual([
      { evt: "cron", job: "fiveMinute", opened: 0, resolved: 0 },
      { evt: "cron", job: "daily", opened: 0, resolved: 0 },
    ]);
  });

  it("maps every JOBS expression to its job and runs nothing for another trigger", async () => {
    expect(Object.keys(JOBS).map((job) => jobForCron(JOBS[job as keyof typeof JOBS]))).toEqual(
      Object.keys(JOBS),
    );
    expect(jobForCron("0 0 * * *")).toBeNull();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = createExecutionContext();
    scheduled(createScheduledController({ cron: "0 0 * * *", scheduledTime: 0 }), workerEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ evt: "cron", step: "no_job" }));
  });
});
