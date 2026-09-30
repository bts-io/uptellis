// The CLI end to end against the fake instance: `--once`, and the long-running mode stopped by SIGTERM.
import { afterAll, afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { join } from "node:path";
import { ResultBuffer } from "../src/buffer";
import { FakeUptellis, KEY, RUNNER } from "./fake-uptellis";
import { cleanup, result, tempDir } from "./helpers";

// These tests spawn the agent CLI; on a busy machine (parallel verify runs) 5 s is too tight.
setDefaultTimeout(20_000);

afterAll(cleanup);

let server: FakeUptellis;
afterEach(() => server?.stop());

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const env = (dir: string) => ({
  PATH: process.env.PATH ?? "",
  UPTELLIS_URL: server.url,
  UPTELLIS_API_KEY: KEY,
  UPTELLIS_RUNNER: RUNNER,
  UPTELLIS_DATA_DIR: dir,
});

describe("uptellis-agent", () => {
  it("--once polls, runs every monitor, delivers and exits 0", async () => {
    server = new FakeUptellis();
    const dir = tempDir();
    const p = Bun.spawn(["bun", MAIN, "--once"], { env: env(dir), stdout: "pipe", stderr: "pipe" });
    const code = await p.exited;
    const stderr = await new Response(p.stderr).text();
    expect(code).toBe(0);
    expect(server.received.map((r) => r.monitorId).sort()).toEqual(["db", "web"]);
    // Logs never carry the key.
    expect(stderr).not.toContain(KEY);
    expect(stderr).toContain('"event":"agent.once"');
  });

  it("--once exits 1 and keeps the results when the instance refuses them", async () => {
    server = new FakeUptellis();
    server.resultStatuses = [503];
    const dir = tempDir();
    const p = Bun.spawn(["bun", MAIN, "--once"], { env: env(dir), stdout: "ignore", stderr: "ignore" });
    expect(await p.exited).toBe(1);
    const b = new ResultBuffer(dir);
    expect(b.size).toBe(2);
    b.close();
  });

  it("exits 2 with a clear message on a bad configuration", async () => {
    server = new FakeUptellis();
    const p = Bun.spawn(["bun", MAIN], {
      env: { ...env(tempDir()), UPTELLIS_RUNNER: "builtin" },
      stdout: "ignore",
      stderr: "pipe",
    });
    expect(await p.exited).toBe(2);
    expect(await new Response(p.stderr).text()).toContain("UPTELLIS_RUNNER must be an agent id");
  });

  it("flushes a buffer left by an earlier run, and stops cleanly on SIGTERM", async () => {
    server = new FakeUptellis();
    const dir = tempDir();
    const b = new ResultBuffer(dir);
    b.append([result("web", Date.now() - 120_000), result("web", Date.now() - 60_000)]);
    b.close();
    const p = Bun.spawn(["bun", MAIN], { env: env(dir), stdout: "ignore", stderr: "pipe" });
    for (let i = 0; i < 100 && server.received.length < 2; i++) await Bun.sleep(50);
    expect(server.received).toHaveLength(2);
    p.kill("SIGTERM");
    expect(await p.exited).toBe(0);
    expect(await new Response(p.stderr).text()).toContain('"event":"agent.stopped"');
    expect(server.requests.some((r) => r.path.endsWith("/monitors"))).toBe(true);
  });
});
