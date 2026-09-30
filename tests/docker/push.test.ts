/**
 * Push monitors on the Docker platform (SQLite, migrations applied at startup): the anonymous push route
 * with the in-memory `push` limiter (one push per 10 s per token), the same 404 for unknown and paused, and
 * the silent rule in the every-minute job (one down, then the next push brings it up).
 */
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { and, eq } from "drizzle-orm";
import { parseSiteConfig } from "@/shared/config";
import { runJob } from "@/worker/cron";
import { schema } from "@/worker/db";
import { D1ConfigStore, resetConfigCache } from "@/worker/engine/config-store";
import { resetSiteSourceSync } from "@/worker/engine/sites";
import app from "@/worker/index";
import { PushTokenStore } from "@/worker/monitors/push-store";
import { type TempPlatform, tempPlatform } from "./support";

// On a 10 s window boundary, so the limiter's windows are predictable.
const NOW = Date.parse("2026-09-28T01:00:00Z");
const ORIGIN = "https://status.example.com";
let t: TempPlatform;
let token = "";
let pausedToken = "";
const logs: string[] = [];

const push = async (tok: string, query = "") => {
  const res = await app.fetch(new Request(`${ORIGIN}/api/push/${tok}${query}`), { platform: t.platform });
  await t.platform.drain();
  return res;
};
const service = async () =>
  (
    await t.platform.db
      .select()
      .from(schema.services)
      .where(and(eq(schema.services.site, "demo"), eq(schema.services.id, "probe:backup")))
  )[0];
const job = (at: number) => runJob(t.platform, "probes", at, { transport: {} as never });

beforeAll(async () => {
  resetConfigCache();
  resetSiteSourceSync();
  t = tempPlatform({ SITE_DEFAULT: "demo" }, NOW);
  spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  const configs = new D1ConfigStore(t.platform);
  const cur = (await configs.load("demo"))!;
  const config = parseSiteConfig({
    ...cur.config,
    probes: [],
    monitors: [
      { id: "backup", name: "Nightly backup", type: "push", intervalS: 60, graceS: 0 },
      { id: "paused", name: "Paused job", type: "push", enabled: false },
    ],
  });
  expect((await configs.save("demo", config, { baseVersion: cur.version, savedBy: "admin" })).ok).toBe(true);
  const store = new PushTokenStore(t.platform);
  token = (await store.issue("demo", "backup", cur.version + 1, NOW)).token;
  pausedToken = (await store.issue("demo", "paused", cur.version + 1, NOW)).token;
});
afterAll(() => t.dispose());

describe("push monitors on SQLite", () => {
  it("accepts one push per 10 s per token and refuses unknown and paused tokens alike", async () => {
    t.clock.now = NOW + 1_000;
    const up = await push(token, "?status=up&msg=OK&ping=12");
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({ ok: true });
    expect(await service()).toMatchObject({ status: "up", latencyMs: 12, source: "probe:push" });

    t.clock.now = NOW + 2_000;
    const flood = await push(token, "?status=down");
    expect(flood.status).toBe(429);
    expect(await service()).toMatchObject({ status: "up" });

    t.clock.now = NOW + 11_000;
    expect((await push(token, "?status=down&msg=disk%20full")).status).toBe(200);
    expect(await service()).toMatchObject({ status: "down" });

    for (const refused of [await push("B".repeat(43)), await push(pausedToken)]) {
      expect(refused.status).toBe(404);
      expect(await refused.json()).toEqual({ ok: false });
    }
  });

  it("marks a silent monitor down once in the every-minute job and comes back with the next push", async () => {
    t.clock.now = NOW + 21_000;
    expect((await push(token, "?status=up")).status).toBe(200);
    const minute = (n: number) => NOW + n * 60_000;
    await job(minute(1));
    const [row] = await t.platform.db
      .select()
      .from(schema.pushTokens)
      .where(and(eq(schema.pushTokens.site, "demo"), eq(schema.pushTokens.monitorId, "backup")));
    expect(row).toMatchObject({ watchSince: minute(1), lastPushAt: NOW + 21_000 });
    expect((await job(minute(2))).push).toMatchObject({ down: 1 });
    expect(await service()).toMatchObject({ status: "down" });
    for (let n = 3; n <= 6; n++) expect((await job(minute(n))).push).toMatchObject({ down: 0, opened: [] });
    const [state] = await t.platform.db
      .select()
      .from(schema.monitorRunners)
      .where(and(eq(schema.monitorRunners.site, "demo"), eq(schema.monitorRunners.monitorId, "backup")));
    expect(state).toMatchObject({ runner: "push", lastTs: minute(2), lastStatus: "down" });

    t.clock.now = minute(6) + 30_000;
    expect((await push(token, "?status=up&msg=back")).status).toBe(200);
    expect(await service()).toMatchObject({ status: "up" });
    for (const line of logs) expect(line).not.toContain(token);
  });
});
