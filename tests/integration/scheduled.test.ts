import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CRON_DAILY, CRON_EVERY_5_MIN } from "@/worker/cron";
import { scheduled } from "@/worker/scheduled";

// The handler src/server.ts exports as `scheduled`, driven the way the runtime drives it.
afterEach(() => vi.restoreAllMocks());

describe("scheduled handler", () => {
  it("runs the job for each wrangler.jsonc trigger inside waitUntil and logs counts only", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    for (const cron of [CRON_EVERY_5_MIN, CRON_DAILY]) {
      const ctx = createExecutionContext();
      scheduled(
        createScheduledController({ cron, scheduledTime: Date.parse("2026-09-28T00:00:00Z") }),
        env as unknown as Env,
        ctx,
      );
      await waitOnExecutionContext(ctx);
    }
    expect(logs.map((l) => JSON.parse(l))).toEqual([
      { evt: "cron", job: "five-minute", opened: 0, resolved: 0 },
      { evt: "cron", job: "daily", opened: 0, resolved: 0 },
    ]);
  });
});
