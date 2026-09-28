/**
 * Monitors on the Docker platform (SQLite): the builtin runner runs every type and reports as
 * `probe:server`, an agent posts results through the agent API with an API key, quorum across both opens
 * the incident, and the key is rate limited by the in-memory `ingest` limiter.
 */
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { and, eq } from "drizzle-orm";
import { RATE_LIMITERS } from "@/platform/types";
import { parseSiteConfig } from "@/shared/config";
import type { RunCheck } from "@/shared/monitors";
import { issueApiKey } from "@/worker/auth/api-keys";
import { runJob } from "@/worker/cron";
import { schema } from "@/worker/db";
import { D1ConfigStore, resetConfigCache } from "@/worker/engine/config-store";
import { resetSiteSourceSync } from "@/worker/engine/sites";
import app from "@/worker/index";
import { type TempPlatform, tempPlatform } from "./support";

const NOW = Date.parse("2026-09-28T01:00:00Z");
const ORIGIN = "https://status.example.com";
const iso = (t: number) => new Date(t).toISOString().replace(".000Z", "Z");
let t: TempPlatform;
let key = "";

const send = async (path: string, init: RequestInit = {}) => {
  const res = await app.fetch(new Request(`${ORIGIN}${path}`, init), {
    platform: t.platform,
    envIngestKeys: {},
  });
  await t.platform.drain();
  return res;
};

const agent = (path: string, init: RequestInit = {}) =>
  send(`/api/agent/v1/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      "x-uptellis-runner": "office-1",
      "content-type": "application/json",
    },
  });

/** Every check down (the gateway is unreachable from everywhere). */
const allDown: RunCheck = async (m, o) => ({
  monitorId: m.id,
  ts: iso(o.now?.() ?? 0),
  status: "down",
  latencyMs: null,
  message: "timeout",
});

beforeAll(async () => {
  resetConfigCache();
  resetSiteSourceSync();
  t = tempPlatform({ SITE_DEFAULT: "demo" }, NOW);
  spyOn(console, "log").mockImplementation(() => {});
  const configs = new D1ConfigStore(t.platform);
  const cur = (await configs.load("demo"))!;
  const config = parseSiteConfig({
    ...cur.config,
    probes: [],
    agents: [{ id: "office-1", name: "Office" }],
    monitors: [
      {
        id: "gw",
        name: "Gateway",
        type: "ping",
        host: "example.org",
        retries: 0,
        runners: ["builtin", "office-1"],
      },
    ],
  });
  expect((await configs.save("demo", config, { baseVersion: cur.version, savedBy: "admin" })).ok).toBe(true);
  key = (await issueApiKey(t.platform, { site: "demo", name: "agent", scopes: ["agent"], createdBy: null }))
    .key;
});
afterAll(() => t.dispose());

describe("monitors on SQLite", () => {
  it("runs ping from builtin as probe:server and confirms down with the agent", async () => {
    const run = await runJob(t.platform, "probes", NOW, {
      runCheck: allDown,
      transport: {} as never,
      now: () => NOW + 2_000,
    });
    expect(run.probes).toMatchObject({
      sites: 1,
      checks: 1,
      down: 1,
      opened: [`probe:gw:${iso(NOW + 2_000)}`],
    });
    // With the agent silent, builtin alone decides.
    const [svc] = await t.platform.db
      .select()
      .from(schema.services)
      .where(and(eq(schema.services.site, "demo"), eq(schema.services.id, "probe:gw")));
    expect(svc).toMatchObject({ source: "probe:server", kind: "ping", status: "down" });

    t.clock.now = NOW + 20_000;
    const monitors = await agent("monitors");
    expect(monitors.status).toBe(200);
    expect(((await monitors.json()) as { monitors: { id: string }[] }).monitors.map((m) => m.id)).toEqual([
      "gw",
    ]);

    const posted = await agent("results", {
      method: "POST",
      body: JSON.stringify({
        v: 1,
        agent: "uptellis-agent/0.3.0",
        sentAt: iso(NOW + 20_000),
        results: [{ monitorId: "gw", ts: iso(NOW + 10_000), status: "up", latencyMs: 4, message: "ok" }],
      }),
    });
    expect(posted.status).toBe(202);
    expect(await posted.json()).toEqual({ accepted: 1, ignored: 0 });
    // One of two runners down: degraded, which ends the outage.
    const [after] = await t.platform.db
      .select({ status: schema.services.status })
      .from(schema.services)
      .where(and(eq(schema.services.site, "demo"), eq(schema.services.id, "probe:gw")));
    expect(after!.status).toBe("degraded");
    const sources = await t.platform.db
      .select({ id: schema.sources.id, seen: schema.sources.lastSeenAt })
      .from(schema.sources)
      .where(eq(schema.sources.site, "demo"));
    expect(sources.find((s) => s.id === "probe:office-1")?.seen).toBe(NOW + 20_000);
    expect(sources.find((s) => s.id === "probe:server")?.seen).toBe(NOW + 2_000);
  });

  it("rate limits the key with the ingest limiter", async () => {
    let limited = -1;
    for (let i = 1; i <= RATE_LIMITERS.ingest.limit + 5; i++) {
      const res = await agent("monitors");
      if (res.status === 429) {
        limited = i;
        break;
      }
    }
    // Two requests of the first case share this window.
    expect(limited).toBe(RATE_LIMITERS.ingest.limit - 1);
  });
});
