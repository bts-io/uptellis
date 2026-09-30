/**
 * Push monitors end to end in workerd over the migrated D1: the admin creates and rotates a push URL
 * (`sources.manage`), an anonymous job calls it with GET or POST (`status`, `msg`, `ping`), every refusal
 * is the same 404, the `push` limiter answers 429 on a flood, and the every-minute job's silent rule marks a
 * quiet monitor down once and brings nothing back until the next push. The token never reaches a log, a
 * stored row (only its hash), the view or the public summary.
 */
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_FIELDS, parseSiteConfig, type SiteConfig } from "@/shared/config";
import { IssuedPushUrl, PushTokenList } from "@/shared/schemas/admin";
import { hashToken } from "@/worker/auth/tokens";
import { runJob } from "@/worker/cron";
import { schema } from "@/worker/db";
import { D1ConfigStore, resetConfigCache } from "@/worker/engine/config-store";
import { KvModelCache } from "@/worker/engine/kv-cache";
import { seedConfig } from "@/worker/engine/sites";
import { testPlatform } from "../support/platform";
import { admin, adminCookie, adminEnv, handle, json, ORIGIN } from "./admin-app";

const platform = testPlatform();
const { db } = platform;
/** The env without the push limiter (its 1 per 10 s would refuse every second call of a case). */
const unlimited = { ...adminEnv, PUSH_RATE_LIMIT: undefined } as unknown as Env;
let api: ReturnType<typeof admin>;
const tokens: string[] = [];
let logs: string[] = [];

/** A public site with push monitors (`backup` every minute, `paused` disabled) and one http monitor. */
function siteConfig(slug: string, monitors: unknown[]): SiteConfig {
  const demo = seedConfig("demo")!;
  return parseSiteConfig({
    ...demo,
    slug,
    name: "Push monitors",
    hostnames: [`${slug}.example.org`],
    visibility: "public",
    public: { enabled: true, fields: [...PUBLIC_FIELDS] },
    notify: { discord: false, channels: [] },
    sources: [],
    probes: [],
    monitors,
    maintenance: [],
    sections: [{ id: "jobs", title: "Jobs", services: ["probe:backup", "probe:paused"] }],
    displayNames: {},
  });
}
const backup = { id: "backup", name: "Nightly backup", type: "push", intervalS: 60, graceS: 0 };
const paused = { id: "paused", name: "Paused job", type: "push", enabled: false };
const web = { id: "web", name: "Web", type: "http", url: "https://example.org/" };

/** Creates (or rotates) a push URL through the admin API; the token is its last path segment. */
async function issue(
  site: string,
  monitor: string,
): Promise<{ url: string; token: string; rotated: boolean }> {
  const res = await api.post(`/sites/${site}/monitors/${monitor}/push-token`);
  expect(res.status).toBe(201);
  const out = IssuedPushUrl.parse(await json(res));
  expect(out.url.startsWith(`${ORIGIN}/api/push/`)).toBe(true);
  const token = out.url.slice(`${ORIGIN}/api/push/`.length);
  tokens.push(token);
  return { url: out.url, token, rotated: out.rotated };
}

const pushGet = (token: string, query = "", e: Env = unlimited) =>
  handle(`/api/push/${token}${query}`, {}, e);
const pushPost = (token: string, body: string, type: string, e: Env = unlimited) =>
  handle(`/api/push/${token}`, { method: "POST", body, headers: { "content-type": type } }, e);

const serviceOf = async (site: string) =>
  (
    await db
      .select()
      .from(schema.services)
      .where(and(eq(schema.services.site, site), eq(schema.services.id, "probe:backup")))
  )[0];
const beats = (site: string) =>
  db
    .select({
      ts: schema.heartbeats.ts,
      status: schema.heartbeats.status,
      message: schema.heartbeats.message,
      important: schema.heartbeats.important,
    })
    .from(schema.heartbeats)
    .where(and(eq(schema.heartbeats.site, site), eq(schema.heartbeats.serviceId, "probe:backup")))
    .orderBy(asc(schema.heartbeats.ts));
const openIncidents = async (site: string) =>
  (await db.select().from(schema.incidents).where(eq(schema.incidents.site, site))).filter((i) => !i.endedAt);

beforeAll(async () => {
  resetConfigCache();
  api = admin(await adminCookie());
  const configs = new D1ConfigStore(platform);
  expect(await configs.create(siteConfig("t-push", [backup, paused, web]))).toBe(true);
  expect(await configs.create(siteConfig("t-push-silent", [backup]))).toBe(true);
});
beforeEach(() => {
  logs = [];
  const keep =
    (level: string) =>
    (...a: unknown[]) =>
      void logs.push(`${level} ${a.map(String).join(" ")}`);
  vi.spyOn(console, "log").mockImplementation(keep("log"));
  vi.spyOn(console, "warn").mockImplementation(keep("warn"));
  vi.spyOn(console, "error").mockImplementation(keep("error"));
});
afterEach(async () => {
  // No token, and no token hash, in anything logged.
  for (const t of tokens) {
    const hash = await hashToken(t);
    for (const line of logs) {
      expect(line).not.toContain(t);
      expect(line).not.toContain(hash);
    }
  }
  vi.restoreAllMocks();
});

// First: the job also arms the push monitors of every other site at the minutes it runs for.
describe("the silent rule in the every-minute job", () => {
  it("marks a silent monitor down once, keeps the bars counting, and the next push brings it up", async () => {
    const site = "t-push-silent";
    const { token } = await issue(site, "backup");
    // Minutes in the past: the job's writes must not be older than the push made at the end.
    const t0 = Math.floor(Date.now() / 60_000) * 60_000 - 10 * 60_000;
    const minute = (n: number) => t0 + n * 60_000;
    const job = (n: number) =>
      runJob(platform, "probes", minute(n), {
        transport: { fetch: (async () => new Response(null, { status: 200 })) as typeof fetch, tcp: vi.fn() },
        sleep: async () => {},
      });

    const armed = await job(0);
    expect(armed.push).toMatchObject({ down: 0, failedSites: 0 });
    expect(await serviceOf(site)).toMatchObject({ status: "pending" });
    const [row] = await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.site, site));
    expect(row).toMatchObject({ watchSince: minute(0), lastPushAt: null });

    // The other site's push monitor (armed by the same job) goes down with it.
    const down = await job(1);
    expect(down.push?.opened).toContain(
      `probe:backup:${new Date(minute(1)).toISOString().replace(".000Z", "Z")}`,
    );
    expect(await serviceOf(site)).toMatchObject({ status: "down" });
    for (let n = 2; n <= 5; n++) expect((await job(n)).push).toMatchObject({ down: 0, opened: [] });

    const [state] = await db
      .select()
      .from(schema.monitorRunners)
      .where(and(eq(schema.monitorRunners.site, site), eq(schema.monitorRunners.monitorId, "backup")));
    expect(state).toMatchObject({
      runner: "push",
      lastTs: minute(1),
      lastStatus: "down",
      consecutiveDown: 1,
    });
    expect((await beats(site)).map((b) => [b.ts, b.status, b.important, b.message])).toEqual([
      [minute(1), "down", true, "no push for 1 min"],
      [minute(2), "down", false, "no push for 2 min"],
      [minute(3), "down", false, "no push for 3 min"],
      [minute(4), "down", false, "no push for 4 min"],
      [minute(5), "down", false, "no push for 5 min"],
    ]);
    expect(await openIncidents(site)).toHaveLength(1);

    expect((await pushGet(token, "?msg=done")).status).toBe(200);
    expect(await serviceOf(site)).toMatchObject({ status: "up" });
    expect(await openIncidents(site)).toEqual([]);
  });
});

describe("push URLs in the admin API", () => {
  it("are created for saved push monitors only, listed without the token, and rotated", async () => {
    expect((await api.post("/sites/t-push/monitors/web/push-token")).status).toBe(404);
    expect((await api.post("/sites/t-push/monitors/nope/push-token")).status).toBe(404);
    expect((await api.post("/sites/unknown-site/monitors/backup/push-token")).status).toBe(404);

    const before = PushTokenList.parse(await json(await api.get("/sites/t-push/push-tokens")));
    expect(before.monitors).toEqual([
      { monitorId: "backup", hasUrl: false, createdAt: null, lastPushAt: null },
      { monitorId: "paused", hasUrl: false, createdAt: null, lastPushAt: null },
    ]);

    const first = await issue("t-push", "backup");
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.rotated).toBe(false);
    const res = await api.get("/sites/t-push/push-tokens");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain(first.token);
    expect(text).not.toContain(await hashToken(first.token));
    expect(PushTokenList.parse(JSON.parse(text)).monitors[0]).toMatchObject({
      monitorId: "backup",
      hasUrl: true,
      lastPushAt: null,
    });

    // Rotating replaces the stored hash: the first token is dead at once, the new one works.
    const second = await issue("t-push", "backup");
    expect(second.rotated).toBe(true);
    expect((await pushGet(first.token)).status).toBe(404);
    expect((await pushGet(second.token)).status).toBe(200);
    const rows = await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.site, "t-push"));
    expect(rows.map((r) => r.tokenHash)).toEqual([await hashToken(second.token)]);
  });

  it("need sources.manage: signed out is refused", async () => {
    const res = await handle("/api/admin/sites/t-push/monitors/backup/push-token", {
      method: "POST",
      headers: { origin: ORIGIN },
    });
    expect(res.status).toBe(401);
    expect((await handle("/api/admin/sites/t-push/push-tokens")).status).toBe(401);
  });
});

describe("the push route", () => {
  it("takes GET and POST (form and JSON) with status, msg and ping, and needs no session", async () => {
    const { token } = await issue("t-push", "backup");
    // Results are per second: a push in the same second as the previous case's is a duplicate.
    await new Promise((r) => setTimeout(r, 1100));
    const up = await pushGet(token, "?status=up&msg=OK&ping=42");
    expect(up.status).toBe(200);
    expect(up.headers.get("cache-control")).toBe("no-store");
    expect(await up.json()).toEqual({ ok: true });
    expect(await serviceOf("t-push")).toMatchObject({
      status: "up",
      latencyMs: 42,
      kind: "push",
      source: "probe:push",
      targetDisplay: "heartbeat every 1 min",
    });

    await new Promise((r) => setTimeout(r, 1100));
    const down = await pushPost(token, "status=down&msg=disk%20full", "application/x-www-form-urlencoded");
    expect(down.status).toBe(200);
    expect(await serviceOf("t-push")).toMatchObject({ status: "down", latencyMs: null });
    expect((await openIncidents("t-push")).map((i) => i.serviceId)).toEqual(["probe:backup"]);
    expect((await beats("t-push")).at(-1)).toMatchObject({ status: "down", message: "disk full" });

    await new Promise((r) => setTimeout(r, 1100));
    const long = `copied to ${[10, 1, 2, 3].join(".")} ${"x".repeat(300)}`;
    const posted = await pushPost(
      token,
      JSON.stringify({ status: "up", msg: long, ping: 7 }),
      "application/json",
    );
    expect(posted.status).toBe(200);
    const last = (await beats("t-push")).at(-1)!;
    expect(last).toMatchObject({ status: "up" });
    expect(last.message).toHaveLength(200);
    expect(last.message!.startsWith("copied to [redacted] xxx")).toBe(true);
    expect(await serviceOf("t-push")).toMatchObject({ status: "up", latencyMs: 7 });
    expect(await openIncidents("t-push")).toEqual([]);

    const list = PushTokenList.parse(await json(await api.get("/sites/t-push/push-tokens")));
    expect(list.monitors[0]!.lastPushAt).not.toBeNull();

    expect((await pushGet(token, "?status=sideways")).status).toBe(400);
  });

  it("answers the same 404 for a malformed, unknown, rotated, paused or removed token", async () => {
    const pausedToken = (await issue("t-push", "paused")).token;
    const rotated = (await issue("t-push", "backup")).token;
    const live = (await issue("t-push", "backup")).token;
    const unknown = "A".repeat(43);
    const refused = [
      await pushGet("short"),
      await pushGet(unknown),
      await pushGet(rotated),
      await pushGet(pausedToken),
      await pushPost(pausedToken, "status=up", "application/x-www-form-urlencoded"),
    ];
    for (const res of refused) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ ok: false });
    }
    expect((await pushGet(live)).status).toBe(200);

    // The monitor leaves the config: its token is dead at once, and the next job deletes the row.
    const configs = new D1ConfigStore(platform);
    const cur = (await configs.load("t-push"))!;
    const saved = await configs.save("t-push", siteConfig("t-push", [paused, web]), {
      baseVersion: cur.version,
      savedBy: "admin",
    });
    expect(saved.ok).toBe(true);
    const gone = await pushGet(live);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ ok: false });
    await runJob(platform, "probes", Math.floor(Date.now() / 60_000) * 60_000, {
      transport: { fetch: (async () => new Response(null, { status: 200 })) as typeof fetch, tcp: vi.fn() },
      sleep: async () => {},
    });
    const rows = await db.select().from(schema.pushTokens).where(eq(schema.pushTokens.site, "t-push"));
    expect(rows.map((r) => r.monitorId)).toEqual(["paused"]);
  });
});

describe("the push limiter", () => {
  it("accepts one push per 10 s per token and answers 429 to the rest", async () => {
    const configs = new D1ConfigStore(platform);
    const cur = (await configs.load("t-push"))!;
    await configs.save("t-push", siteConfig("t-push", [backup, paused, web]), {
      baseVersion: cur.version,
      savedBy: "admin",
    });
    const { token } = await issue("t-push", "backup");
    // workerd's local limiter counts in wall clock windows: start clear of a boundary.
    const into = Date.now() % 10_000;
    if (into > 7_000) await new Promise((r) => setTimeout(r, 10_000 - into + 100));
    expect((await pushGet(token, "", adminEnv)).status).toBe(200);
    const flood = await pushGet(token, "", adminEnv);
    expect(flood.status).toBe(429);
    expect(flood.headers.get("retry-after")).toBe("10");
    expect(await flood.json()).toEqual({ ok: false });
  });
});

describe("where the token never goes", () => {
  it("is in no stored row but its hash, nor in the view, the public summary or the cache", async () => {
    expect(tokens.length).toBeGreaterThan(0);
    const tables = [
      schema.services,
      schema.heartbeats,
      schema.incidents,
      schema.sources,
      schema.snapshots,
      schema.monitorRunners,
      schema.notifications,
      schema.siteConfigs,
      schema.pushTokens,
    ];
    const dump = JSON.stringify(await Promise.all(tables.map((t) => db.select().from(t))));
    for (const t of tokens) expect(dump).not.toContain(t);

    const view = await (await handle("/api/sites/t-push/view")).text();
    const summary = await (await handle("/api/public/t-push/summary.json")).text();
    const cached = JSON.stringify(await new KvModelCache(platform.kv).get("t-push"));
    expect(view).toContain("Nightly backup");
    expect(summary).toContain("t-push");
    for (const text of [view, summary, cached]) {
      for (const t of tokens) expect(text).not.toContain(t);
      expect(text).not.toContain("/api/push/");
    }
  });
});
