import { describe, expect, it } from "bun:test";
import { Backoff } from "../src/backoff";
import { epochMinute, isDue, msToNextMinute, Pool } from "../src/schedule";

describe("minute alignment (same rule as the builtin runner)", () => {
  const at = (iso: string) => epochMinute(Date.parse(iso));

  it("runs a 60 s monitor every minute", () => {
    for (let m = 0; m < 5; m++) expect(isDue({ intervalS: 60, enabled: true }, 29_000_000 + m)).toBe(true);
  });

  it("runs a 300 s monitor on minutes divisible by 5 of the epoch", () => {
    const due = [];
    for (let m = 0; m < 20; m++) {
      if (isDue({ intervalS: 300, enabled: true }, at("2026-09-28T12:00:00Z") + m)) due.push(m);
    }
    expect(due).toEqual([0, 5, 10, 15]);
    expect(isDue({ intervalS: 300, enabled: true }, at("2026-09-28T12:07:59Z"))).toBe(false);
    expect(isDue({ intervalS: 3600, enabled: true }, at("2026-09-28T13:00:30Z"))).toBe(true);
    expect(isDue({ intervalS: 3600, enabled: true }, at("2026-09-28T13:01:00Z"))).toBe(false);
  });

  it("never runs a disabled monitor", () => {
    expect(isDue({ intervalS: 60, enabled: false }, 0)).toBe(false);
  });

  it("sleeps to the next minute boundary", () => {
    expect(msToNextMinute(Date.parse("2026-09-28T12:00:00Z"))).toBe(60_000);
    expect(msToNextMinute(Date.parse("2026-09-28T12:00:59.250Z"))).toBe(750);
  });
});

describe("Pool", () => {
  it("never runs more than its limit at once", async () => {
    const pool = new Pool(2);
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(5);
      active--;
    };
    await Promise.all(Array.from({ length: 7 }, () => pool.run(task)));
    expect(peak).toBe(2);
    expect(pool.pending).toBe(0);
  });
});

describe("Backoff", () => {
  it("doubles transient delays with jitter up to 5 minutes and honours Retry-After", () => {
    let now = 0;
    const b = new Backoff(
      () => now,
      () => 0.5,
    );
    expect(b.fail("transient")).toBe(5_000);
    expect(b.fail("transient")).toBe(10_000);
    for (let i = 0; i < 10; i++) b.fail("transient");
    expect(b.fail("transient")).toBe(300_000);
    b.reset();
    expect(b.fail("transient", 60_000)).toBe(60_000);
    now = 30_000;
    expect(b.remaining()).toBe(30_000);
  });

  it("backs off minutes after an auth failure (5 min base, 30 min cap, jittered)", () => {
    const b = new Backoff(
      () => 0,
      () => 0,
    );
    expect(b.fail("auth")).toBe(225_000);
    for (let i = 0; i < 5; i++) b.fail("auth");
    expect(b.fail("auth")).toBe(1_350_000);
  });
});
