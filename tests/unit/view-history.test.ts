import { describe, expect, it } from "vitest";
import { type BeatCounts, foldHistory, worstOf } from "../../src/worker/db/history";

const DAY = 86_400_000;
const dayIdx = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY;
const counts = (serviceId: string, day: string, c: Partial<BeatCounts>): BeatCounts => ({
  serviceId,
  dayIdx: dayIdx(day),
  total: 0,
  up: 0,
  down: 0,
  maint: 0,
  pending: 0,
  minutesDown: 0,
  ...c,
});

describe("worstOf", () => {
  it("ranks down, then the unrolled remainder (degraded), pending, maintenance, up", () => {
    const base = { total: 10, up: 10, down: 0, maint: 0, pending: 0 };
    expect(worstOf(base)).toBe("up");
    expect(worstOf({ ...base, up: 9, maint: 1 })).toBe("maintenance");
    expect(worstOf({ ...base, up: 8, maint: 1, pending: 1 })).toBe("pending");
    expect(worstOf({ ...base, up: 8, pending: 1 })).toBe("degraded");
    expect(worstOf({ ...base, up: 7, down: 1, pending: 1 })).toBe("down");
    expect(worstOf({ total: 0, up: 0, down: 0, maint: 0, pending: 0 })).toBe("unknown");
  });
});

describe("foldHistory", () => {
  it("sums rollup and raw rows of the same day, services by id, days oldest first", () => {
    const out = foldHistory([
      counts("kuma:2", "2026-09-27", { total: 288, up: 288 }),
      counts("kuma:10", "2026-09-27", { total: 100, up: 90, down: 10, minutesDown: 25 }),
      counts("kuma:10", "2026-09-26", { total: 1440, up: 1440 }),
      // The current window's raw beats, not folded yet.
      counts("kuma:10", "2026-09-27", { total: 5, up: 3, down: 2, minutesDown: 2 }),
    ]);
    expect(out.map((s) => s.serviceId)).toEqual(["kuma:10", "kuma:2"]);
    expect(out[0]!.days).toEqual([
      { day: "2026-09-26", worst: "up", uptime: 1, minutesDown: 0 },
      { day: "2026-09-27", worst: "down", uptime: 0.885714, minutesDown: 27 },
    ]);
    expect(out[1]!.days).toEqual([{ day: "2026-09-27", worst: "up", uptime: 1, minutesDown: 0 }]);
  });

  it("excludes maintenance from uptime; a day of only maintenance is 100%", () => {
    const [s] = foldHistory([
      counts("kuma:1", "2026-09-25", { total: 10, up: 4, down: 1, maint: 5, minutesDown: 5 }),
      counts("kuma:1", "2026-09-26", { total: 12, maint: 12 }),
    ]);
    expect(s!.days).toEqual([
      { day: "2026-09-25", worst: "down", uptime: 0.8, minutesDown: 5 },
      { day: "2026-09-26", worst: "maintenance", uptime: 1, minutesDown: 0 },
    ]);
  });

  it("caps minutes down at a whole day and returns nothing for no rows", () => {
    const [s] = foldHistory([counts("kuma:1", "2026-09-25", { total: 300, down: 300, minutesDown: 1500 })]);
    expect(s!.days[0]).toMatchObject({ worst: "down", uptime: 0, minutesDown: 1440 });
    expect(foldHistory([])).toEqual([]);
  });
});
