/** Docker's scheduler: cron matching for `JOBS`, dispatch per minute, no overlap, failures logged by name. */
import { describe, expect, it, spyOn } from "bun:test";
import { cronMatches, dueJobs, startScheduler } from "@/platform/docker/scheduler";
import type { JobName } from "@/platform/types";

const at = (iso: string) => Date.parse(iso);

describe("cronMatches", () => {
  it("reads the JOBS expressions in UTC", () => {
    expect(cronMatches("* * * * *", at("2026-09-28T13:37:59Z"))).toBe(true);
    expect(cronMatches("*/5 * * * *", at("2026-09-28T13:35:00Z"))).toBe(true);
    expect(cronMatches("*/5 * * * *", at("2026-09-28T13:36:00Z"))).toBe(false);
    expect(cronMatches("17 3 * * *", at("2026-09-28T03:17:30Z"))).toBe(true);
    expect(cronMatches("17 3 * * *", at("2026-09-28T04:17:00Z"))).toBe(false);
  });

  it("supports lists, ranges, steps and both day fields", () => {
    expect(cronMatches("0,30 9-17/2 * * *", at("2026-09-28T11:30:00Z"))).toBe(true);
    expect(cronMatches("0,30 9-17/2 * * *", at("2026-09-28T10:30:00Z"))).toBe(false);
    // 2026-09-28 is a Monday; 7 is Sunday like 0.
    expect(cronMatches("0 0 * * 1", at("2026-09-28T00:00:00Z"))).toBe(true);
    expect(cronMatches("0 0 * * 7", at("2026-09-27T00:00:00Z"))).toBe(true);
    // Both day fields restricted: either matches.
    expect(cronMatches("0 0 1 * 1", at("2026-09-28T00:00:00Z"))).toBe(true);
    expect(cronMatches("0 0 1 * 2", at("2026-09-28T00:00:00Z"))).toBe(false);
    expect(() => cronMatches("* * *", 0)).toThrow();
    expect(() => cronMatches("61 * * * *", 0)).toThrow();
  });

  it("picks the due jobs of a minute", () => {
    expect(dueJobs(at("2026-09-28T03:17:00Z"))).toEqual(["probes", "daily"]);
    expect(dueJobs(at("2026-09-28T03:20:00Z"))).toEqual(["probes", "fiveMinute"]);
    expect(dueJobs(at("2026-09-28T03:21:00Z"))).toEqual(["probes"]);
  });
});

describe("startScheduler", () => {
  it("runs each due job at the minute's start, never overlapping itself, and logs failures by name", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    const calls: [JobName, number][] = [];
    let release = () => {};
    const slowProbes = new Promise<void>((r) => {
      release = r;
    });
    const scheduler = startScheduler(async (job, scheduledTime) => {
      calls.push([job, scheduledTime]);
      if (job === "probes" && calls.length === 1) await slowProbes;
      if (job === "fiveMinute") throw new RangeError("detail that must not be logged");
    });

    scheduler.tick(at("2026-09-28T03:19:42Z"));
    scheduler.tick(at("2026-09-28T03:20:03Z"));
    expect(calls).toEqual([
      ["probes", at("2026-09-28T03:19:00Z")],
      ["fiveMinute", at("2026-09-28T03:20:00Z")],
    ]);
    expect(warn.mock.calls.map((c) => c.join(" "))).toEqual([
      JSON.stringify({ evt: "scheduler", job: "probes", step: "skipped_overlap" }),
    ]);

    release();
    await scheduler.stop();
    expect(error.mock.calls.map((c) => c.join(" "))).toEqual([
      JSON.stringify({ evt: "scheduler", job: "fiveMinute", step: "failed", name: "RangeError" }),
    ]);
    scheduler.tick(at("2026-09-28T03:21:00Z"));
    expect(calls.at(-1)).toEqual(["probes", at("2026-09-28T03:21:00Z")]);
    await scheduler.stop();
    warn.mockRestore();
    error.mockRestore();
  });

  it("wakes at the next minute boundary", async () => {
    let now = at("2026-09-28T03:21:59.950Z");
    const calls: JobName[] = [];
    const scheduler = startScheduler(
      async (job) => {
        calls.push(job);
      },
      { now: () => now },
    );
    now = at("2026-09-28T03:22:00Z");
    await new Promise((r) => setTimeout(r, 120));
    await scheduler.stop();
    expect(calls).toEqual(["probes"]);
  });
});
