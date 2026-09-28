import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MONITORS_FILE } from "../src/monitors-store";
import { epochMinute } from "../src/schedule";
import { AGENT_API_PREFIX, MAX_RESULTS_PER_BATCH, RUNNER_HEADER } from "../src/shared";
import { FakeUptellis, KEY, monitor, RUNNER } from "./fake-uptellis";
import { cleanup, makeAgent, result, tempDir } from "./helpers";

afterAll(cleanup);

let server: FakeUptellis;
afterEach(() => server?.stop());

const T = Date.parse("2026-09-28T12:00:00Z");
const MIN = epochMinute(T);
const resultPosts = () => server.requests.filter((r) => r.path.endsWith("/results"));

describe("polling the monitors", () => {
  it("sends the key and runner, keeps the ETag and answers 304 with the list it has", async () => {
    server = new FakeUptellis();
    const { agent } = makeAgent(server.url, tempDir());
    expect(await agent.poll()).toBe("changed");
    expect(agent.monitors.map((m) => m.id)).toEqual(["web", "db"]);
    expect(await agent.poll()).toBe("unchanged");
    const [first, second] = server.requests;
    expect(first!.path).toBe(`${AGENT_API_PREFIX}/monitors`);
    expect(first!.headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(first!.headers.get(RUNNER_HEADER)).toBe(RUNNER);
    expect(first!.headers.get("if-none-match")).toBeNull();
    expect(second!.headers.get("if-none-match")).toBe('"v1"');
    expect(second!.headers.get("user-agent")).toMatch(/^uptellis-agent\//);

    server.monitors = [monitor("web", { intervalS: 300 })];
    server.etag = '"v2"';
    server.pollS = 120;
    expect(await agent.poll()).toBe("changed");
    expect(agent.monitors.map((m) => [m.id, m.intervalS])).toEqual([["web", 300]]);
    expect(agent.pollS).toBe(120);
  });

  it("restores the last list (and its ETag) after a restart while the instance is down", async () => {
    server = new FakeUptellis();
    const dir = tempDir();
    await makeAgent(server.url, dir).agent.poll();
    expect(existsSync(join(dir, MONITORS_FILE))).toBe(true);

    server.monitorsStatus = 503;
    const { agent } = makeAgent(server.url, dir);
    expect(agent.monitors.map((m) => m.id)).toEqual(["web", "db"]);
    expect(await agent.poll()).toBe("failed");
    expect(agent.monitors).toHaveLength(2);
    expect(agent.pollBackoff.remaining()).toBeGreaterThan(0);

    server.monitorsStatus = null;
    expect(await agent.poll()).toBe("unchanged");
    expect(server.requests.at(-1)!.headers.get("if-none-match")).toBe('"v1"');
  });

  it("backs off for minutes on 401 and keeps the list it has", async () => {
    server = new FakeUptellis();
    const dir = tempDir();
    await makeAgent(server.url, dir).agent.poll();
    const { agent } = makeAgent(server.url, dir, { key: `upt_zzzzzzzzzzzz_${"x".repeat(43)}` });
    expect(await agent.poll()).toBe("failed");
    expect(agent.pollBackoff.remaining()).toBeGreaterThanOrEqual(4 * 60_000);
    expect(agent.monitors).toHaveLength(2);
  });
});

describe("scheduling", () => {
  it("runs only the monitors due on the minute, aligned to the epoch", async () => {
    server = new FakeUptellis();
    const ran: string[] = [];
    const { agent } = makeAgent(server.url, tempDir(), {
      now: () => T,
      runCheck: async (m, o) => {
        ran.push(m.id);
        return result(m.id, o.now!());
      },
    });
    server.monitors = [
      monitor("every-min"),
      monitor("two-min", { intervalS: 120 }),
      monitor("five-min", { intervalS: 300 }),
      monitor("paused", { enabled: false }),
    ];
    await agent.poll();
    for (let m = MIN; m < MIN + 5; m++) await agent.tick(m);
    // 12:00 is divisible by 2 and 5 minutes of the epoch.
    expect(ran.filter((x) => x === "every-min")).toHaveLength(5);
    expect(ran.filter((x) => x === "two-min")).toHaveLength(3);
    expect(ran.filter((x) => x === "five-min")).toHaveLength(1);
    expect(ran).not.toContain("paused");
  });

  it("skips a monitor whose previous check is still running", async () => {
    server = new FakeUptellis();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    const { agent, buffer } = makeAgent(server.url, tempDir(), {
      now: () => T,
      runCheck: async (m, o) => {
        calls++;
        await gate;
        return result(m.id, o.now!());
      },
    });
    server.monitors = [monitor("slow")];
    await agent.poll();
    const first = agent.tick(MIN);
    await agent.tick(MIN + 1);
    release();
    await first;
    expect(calls).toBe(1);
    expect(buffer.size).toBe(1);
  });

  it("buffers only valid results for the monitor that ran", async () => {
    server = new FakeUptellis();
    const { agent, buffer } = makeAgent(server.url, tempDir(), {
      now: () => T,
      runCheck: async (m) => {
        if (m.id === "web") throw new Error("bug");
        return { ...result("other", T) };
      },
    });
    await agent.poll();
    await agent.tick(MIN);
    expect(buffer.size).toBe(0);
  });
});

describe("delivery", () => {
  it("buffers while the instance is down, then delivers everything once, in order", async () => {
    server = new FakeUptellis();
    const dir = tempDir();
    let now = T;
    const { agent, buffer } = makeAgent(server.url, dir, { now: () => now });
    await agent.poll();
    server.down();

    for (let m = 0; m < 10; m++) {
      now = T + m * 60_000;
      await agent.tick(epochMinute(now));
      expect(await agent.flush()).toBe("backoff");
    }
    // web every minute, db every other minute.
    expect(buffer.size).toBe(15);
    expect(server.received).toHaveLength(0);

    server.up();
    now += agent.flushBackoff.remaining();
    await agent.tick(epochMinute(now));
    const total = buffer.size;
    expect(total).toBeGreaterThan(15);
    expect(await agent.flush()).toBe("empty");
    expect(buffer.size).toBe(0);

    const got = server.received.map((r) => `${r.monitorId}@${r.ts}`);
    expect(got).toHaveLength(total);
    expect(new Set(got).size).toBe(total);
    for (const id of ["web", "db"]) {
      const ts = server.received.filter((r) => r.monitorId === id).map((r) => r.ts);
      expect(ts).toEqual([...ts].sort());
    }
    expect(server.batches[0]!.agent).toMatch(/^uptellis-agent\/[0-9]/);
    expect(resultPosts()[0]!.headers.get(RUNNER_HEADER)).toBe(RUNNER);
    expect(resultPosts()[0]!.headers.get("authorization")).toBe(`Bearer ${KEY}`);
  });

  it("delivers a non-empty buffer after a restart, and nothing twice", async () => {
    server = new FakeUptellis();
    const dir = tempDir();
    const first = makeAgent(server.url, dir, { now: () => T });
    await first.agent.poll();
    server.down();
    await first.agent.tick(MIN);
    await first.agent.tick(MIN + 1);
    expect(await first.agent.stop(1000)).toBe("backoff");
    first.buffer.close();

    server.up();
    const second = makeAgent(server.url, dir, { now: () => T + 120_000 });
    expect(second.buffer.size).toBe(3);
    expect(await second.agent.flush()).toBe("empty");
    second.buffer.close();
    expect(server.received.map((r) => r.monitorId)).toEqual(["web", "db", "web"]);

    const third = makeAgent(server.url, dir, { now: () => T + 180_000 });
    expect(third.buffer.size).toBe(0);
    expect(await third.agent.flush()).toBe("empty");
    expect(server.received).toHaveLength(3);
  });

  it("keeps the buffer across 5xx and 429, backing off exponentially", async () => {
    server = new FakeUptellis();
    const { agent, buffer } = makeAgent(server.url, tempDir(), { now: () => T });
    buffer.append([result("web", T)]);
    server.resultStatuses = [503, 429, 500];
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      expect(await agent.flush({ force: true })).toBe("backoff");
      delays.push(agent.flushBackoff.remaining());
    }
    expect(delays).toEqual([5_000, 10_000, 20_000]);
    expect(buffer.size).toBe(1);
    // While backing off, a normal flush sends nothing.
    expect(await agent.flush()).toBe("backoff");
    expect(resultPosts()).toHaveLength(3);
    expect(await agent.flush({ force: true })).toBe("empty");
    expect(server.received).toHaveLength(1);
  });

  it("on 401 keeps buffering and stops hammering", async () => {
    server = new FakeUptellis();
    const { agent, buffer } = makeAgent(server.url, tempDir(), {
      now: () => T,
      key: `upt_zzzzzzzzzzzz_${"x".repeat(43)}`,
    });
    buffer.append([result("web", T), result("db", T)]);
    expect(await agent.flush()).toBe("auth");
    expect(agent.flushBackoff.remaining()).toBeGreaterThanOrEqual(4 * 60_000);
    for (let i = 0; i < 5; i++) expect(await agent.flush()).toBe("auth");
    expect(resultPosts()).toHaveLength(1);
    expect(buffer.size).toBe(2);
  });

  it("drops a batch the instance refuses with 400 and carries on", async () => {
    server = new FakeUptellis();
    const { agent, buffer } = makeAgent(server.url, tempDir(), { now: () => T });
    buffer.append(Array.from({ length: MAX_RESULTS_PER_BATCH + 10 }, (_, i) => result("web", T + i * 1000)));
    server.resultStatuses = [400];
    expect(await agent.flush()).toBe("empty");
    expect(agent.refused).toBe(MAX_RESULTS_PER_BATCH);
    expect(server.received).toHaveLength(10);
    expect(server.received[0]!.ts).toBe(new Date(T + MAX_RESULTS_PER_BATCH * 1000).toISOString());
  });

  it("splits a batch on 413 and delivers all of it in order", async () => {
    server = new FakeUptellis();
    const { agent, buffer } = makeAgent(server.url, tempDir(), { now: () => T });
    const n = 40;
    buffer.append(Array.from({ length: n }, (_, i) => result("web", T + i * 1000)));
    server.maxBytes = 2_500;
    expect(await agent.flush()).toBe("empty");
    expect(server.received.map((r) => r.ts)).toEqual(
      Array.from({ length: n }, (_, i) => new Date(T + i * 1000).toISOString()),
    );
    expect(server.batches.length).toBeGreaterThanOrEqual(2);
    expect(resultPosts().length).toBeGreaterThan(server.batches.length);
  });

  it("keeps each request under the byte cap and the count cap", async () => {
    server = new FakeUptellis();
    const { agent, buffer } = makeAgent(server.url, tempDir(), { now: () => T, maxBatchBytes: 4_000 });
    buffer.append(Array.from({ length: 120 }, (_, i) => result("web", T + i * 1000, "x".repeat(100))));
    expect(await agent.flush()).toBe("empty");
    expect(server.received).toHaveLength(120);
    expect(server.batches.every((b) => Buffer.byteLength(JSON.stringify(b)) <= 4_000)).toBe(true);
  });

  it("flushes what it has on stop", async () => {
    server = new FakeUptellis();
    const { agent, buffer } = makeAgent(server.url, tempDir(), { now: () => T });
    await agent.poll();
    await agent.tick(MIN);
    expect(await agent.stop(1000)).toBe("empty");
    expect(buffer.size).toBe(0);
    expect(server.received.map((r) => r.monitorId).sort()).toEqual(["db", "web"]);
  });
});
