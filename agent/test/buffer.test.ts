import { afterAll, describe, expect, it } from "bun:test";
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BUFFER_FILE, ResultBuffer } from "../src/buffer";
import { cleanup, result, tempDir } from "./helpers";

afterAll(cleanup);

const T = Date.parse("2026-09-28T12:00:00Z");
const ids = (b: ResultBuffer) => b.peek(1_000_000).map((e) => e.result.message);

describe("ResultBuffer", () => {
  it("keeps results in order across a restart and forgets dropped ones", () => {
    const dir = tempDir();
    const a = new ResultBuffer(dir, { now: () => T });
    a.append([result("web", T, "r1"), result("web", T + 60_000, "r2")]);
    a.append([result("web", T + 120_000, "r3")]);
    const first = a.peek(2);
    expect(a.drop(first.at(-1)!.seq)).toBe(2);
    a.close();

    const b = new ResultBuffer(dir, { now: () => T });
    expect(ids(b)).toEqual(["r3"]);
    b.append([result("web", T + 180_000, "r4")]);
    b.close();
    expect(ids(new ResultBuffer(dir, { now: () => T }))).toEqual(["r3", "r4"]);
  });

  it("skips a torn last line and unreadable lines", () => {
    const dir = tempDir();
    const a = new ResultBuffer(dir, { now: () => T });
    a.append([result("web", T, "ok")]);
    a.close();
    appendFileSync(join(dir, BUFFER_FILE), 'garbage\n{"s":9,"r":{"monitorId":"web","ts":"2026');
    const b = new ResultBuffer(dir, { now: () => T });
    expect(ids(b)).toEqual(["ok"]);
    // The load rewrote the log without the bad lines.
    expect(readFileSync(join(dir, BUFFER_FILE), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("evicts the oldest results beyond the count cap", () => {
    const dir = tempDir();
    const b = new ResultBuffer(dir, { now: () => T, maxResults: 3 });
    b.append([1, 2, 3, 4, 5].map((i) => result("web", T + i * 1000, `r${i}`)));
    expect(ids(b)).toEqual(["r3", "r4", "r5"]);
    expect(b.evicted).toBe(2);
    b.close();
    expect(ids(new ResultBuffer(dir, { now: () => T, maxResults: 3 }))).toEqual(["r3", "r4", "r5"]);
  });

  it("evicts results older than 24 hours", () => {
    const dir = tempDir();
    let now = T;
    const b = new ResultBuffer(dir, { now: () => now });
    b.append([result("web", T, "old"), result("web", T + 3_600_000, "newer")]);
    now = T + 24 * 3_600_000 + 1000;
    expect(ids(b)).toEqual(["newer"]);
    expect(b.evicted).toBe(1);
  });

  it("compacts the log once it is empty or mostly dead", () => {
    const dir = tempDir();
    const b = new ResultBuffer(dir, { now: () => T });
    const path = join(dir, BUFFER_FILE);
    const big = Array.from({ length: 3000 }, (_, i) => result("web", T + i * 1000, `result number ${i}`));
    b.append(big);
    const full = statSync(path).size;
    expect(full).toBeGreaterThan(256 * 1024);
    b.drop(b.peek(2000).at(-1)!.seq);
    expect(statSync(path).size).toBeLessThan(full / 2);
    expect(ids(b)[0]).toBe("result number 2000");
    b.drop(b.peek(1000).at(-1)!.seq);
    expect(statSync(path).size).toBe(0);
    b.close();
    expect(new ResultBuffer(dir, { now: () => T }).size).toBe(0);
  });
});
