import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomNonce, signRequest } from "@/shared/signing";
import { type AppEnv, platformContext } from "@/worker/app-env";
import { runJob } from "@/worker/cron";
import { schema } from "@/worker/db";
import { D1Store } from "@/worker/engine/d1-store";
import { seedConfigs } from "@/worker/engine/sites";
import { appBackend } from "@/worker/index";
import { ingestRoutes } from "@/worker/ingest/routes";
import { StaleNotifier } from "@/worker/notify";
import type { DiscordCard } from "@/worker/notify/card";
import { fetchWith, testPlatform, workerEnv } from "../support/platform";
import { adminCookie, adminEnv, handle } from "./admin-app";
import { beat, delta, service } from "./storage-helpers";

// Never a real webhook: every request to it goes to the mocked fetch below.
const HOOK = "https://discord.test/api/webhooks/1/test";
const platform = testPlatform();
const hooked = testPlatform({ DISCORD_WEBHOOK_URL: HOOK });
const db = platform.db;
const T = (hms: string) => `2026-09-27T${hms}Z`;
const at = (hms: string) => Date.parse(T(hms));

afterEach(() => vi.restoreAllMocks());

/** The five-minute job with the webhook set, once its cards were sent. */
async function sweep(scheduledTime: number) {
  const r = await runJob(hooked, "fiveMinute", scheduledTime);
  await hooked.drain();
  return r;
}

/** Mocks Discord: records each card posted to HOOK and answers `status`. */
function discord(status = 200) {
  const cards: DiscordCard[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin + url.pathname !== HOOK) throw new Error(`unexpected fetch to ${url.origin}`);
    cards.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "1" }, { status });
  });
  return { cards, spy };
}

const text = (card: DiscordCard) =>
  card.components[0].components.flatMap((c) => (c.type === 10 ? [c.content] : [])).join("\n");
/** The cards of one site (the cron sweeps every site in D1). */
const ofSite = (cards: DiscordCard[], site: string) =>
  cards.filter((c) => text(c).includes(`-# Uptellis · ${site} ·`));

const rows = (site: string) =>
  db.select().from(schema.notifications).where(eq(schema.notifications.site, site));

describe("stale notifications from the 5-minute sweep", () => {
  it("posts one card when a source goes stale and none on the next sweeps", async () => {
    const site = "t-notify-sweep";
    const store = new D1Store(platform);
    await store.applyDelta(delta(site, T("10:00:00"), { services: [service(site, "1", "up")] }));
    await store.applyDelta({
      site,
      generatedAt: T("10:05:00"),
      source: { sourceId: "facts:app-1", seenAt: T("10:05:00"), ok: true, error: null },
      services: [],
      heartbeats: [],
      facts: [],
    });
    const { cards } = discord();

    const first = await sweep(at("10:06:00"));
    expect(first.opened?.filter((i) => i.site === site).map((i) => i.sourceId)).toEqual(["kuma:watch-1"]);
    const mine = ofSite(cards, site);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.components[0].accent_color).toBe(0x7f1d1d);
    expect(text(mine[0]!)).toContain("### 🚨 Uptellis: kuma:watch-1 went silent");
    expect(text(mine[0]!)).toContain("**Last report:** 2026-09-27 10:00 UTC (6 min ago)");
    expect(text(mine[0]!)).toContain("**Still reporting:** facts:app-1");

    // A retried or later sweep sees the incident already open: no second card.
    await sweep(at("10:06:00"));
    await sweep(at("10:11:00"));
    expect(ofSite(cards, site)).toHaveLength(1);
    expect(await rows(site)).toEqual([
      expect.objectContaining({ kind: "open", status: "sent", error: null, sentAt: expect.any(Number) }),
    ]);
  });

  it("claims each transition once, even when handed the same incident twice", async () => {
    const site = "t-notify-claim";
    const store = new D1Store(platform);
    await store.applyDelta(delta(site, T("10:00:00"), {}));
    const r = await store.sweepStaleness(site, T("10:06:00"));
    const { cards } = discord();
    const notifier = new StaleNotifier({
      db,
      configs: seedConfigs,
      webhookUrl: HOOK,
      now: () => at("10:06:00"),
    });
    await notifier.notify(site, { opened: r.incidentsOpened, resolved: [] });
    await notifier.notify(site, { opened: r.incidentsOpened, resolved: [] });
    expect(cards).toHaveLength(1);
  });

  it("records a failed send without throwing", async () => {
    const site = "t-notify-fail";
    const store = new D1Store(platform);
    await store.applyDelta(delta(site, T("10:00:00"), {}));
    const { cards } = discord(500);
    const r = await sweep(at("10:06:00"));
    expect(r.opened?.some((i) => i.site === site)).toBe(true);
    expect(ofSite(cards, site)).toHaveLength(1);
    expect(await rows(site)).toEqual([
      expect.objectContaining({ status: "failed", error: "http_500", sentAt: null }),
    ]);
  });

  it("posts nothing for service down and up incidents", async () => {
    const site = "t-notify-down";
    const store = new D1Store(platform);
    const down = await store.applyDelta(
      delta(site, T("10:00:00"), {
        services: [service(site, "1", "down")],
        heartbeats: [beat(site, "kuma:1", T("09:59:30"), "down")],
      }),
    );
    const up = await store.applyDelta(
      delta(site, T("10:01:00"), {
        services: [service(site, "1", "up")],
        heartbeats: [beat(site, "kuma:1", T("10:00:30"), "up")],
      }),
    );
    expect(down.incidentsOpened.map((i) => i.kind)).toEqual(["down"]);
    expect(up.incidentsResolved.map((i) => i.kind)).toEqual(["down"]);
    const { spy } = discord();
    const notifier = new StaleNotifier({ db, configs: seedConfigs, webhookUrl: HOOK });
    await notifier.notify(site, { opened: down.incidentsOpened, resolved: up.incidentsResolved });
    expect(spy).not.toHaveBeenCalled();
    expect(await rows(site)).toEqual([]);
  });

  it("does nothing without the webhook secret", async () => {
    const site = "t-notify-off";
    await new D1Store(platform).applyDelta(delta(site, T("10:00:00"), {}));
    const { spy } = discord();
    const r = await runJob(platform, "fiveMinute", at("10:06:00"));
    expect(r.opened?.some((i) => i.site === site)).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("recovery at ingest", () => {
  const ORIGIN = "https://worker.example.net";
  let now = new Date(T("10:00:00"));
  const app = new Hono<AppEnv>().use(platformContext);
  app.route("/api/ingest", ingestRoutes(appBackend, { now: () => now }));

  /** A signed Kuma snapshot from the collector at `now`, with one monitor and these beats. */
  async function kuma(beats: { ts: string; status: 0 | 1 }[]) {
    const body = JSON.stringify({
      v: 1,
      generatedAt: now.toISOString(),
      host: "watch-1",
      reachable: true,
      kuma: { version: null, latestVersion: null, dbSizeBytes: null, timezone: null },
      monitors: [
        {
          id: 1,
          name: "Forgejo",
          type: "http",
          url: "https://git.example.com",
          hostname: null,
          port: null,
          method: "GET",
          intervalS: 60,
          timeoutS: 48,
          active: true,
        },
      ],
      heartbeatsSince: beats.map((b) => ({
        monitorId: 1,
        ts: b.ts,
        status: b.status,
        pingMs: 90,
        msg: null,
      })),
      importantHeartbeats: [],
      uptime: {},
      avgPing: {},
      certInfo: {},
    });
    const path = "/api/ingest/kuma";
    const headers = await signRequest(
      workerEnv.INGEST_KEY_COLLECTOR_1,
      "collector-1",
      "POST",
      path,
      body,
      now,
      randomNonce(),
    );
    return fetchWith(
      app,
      new Request(`${ORIGIN}${path}`, {
        method: "POST",
        body,
        headers: { "content-type": "application/json", ...headers },
      }),
      { DISCORD_WEBHOOK_URL: HOOK },
    );
  }

  it("posts the recovered card with the gap and the backfilled beats, and nothing for down/up", async () => {
    const { cards } = discord();
    // A down beat opens a `down` incident: no card.
    expect((await kuma([{ ts: T("09:59:30"), status: 0 }])).status).toBe(202);
    expect(cards).toHaveLength(0);

    await sweep(at("10:06:00"));
    expect(ofSite(cards, "demo").map((c) => c.components[0].accent_color)).toEqual([0x7f1d1d]);

    // Back at 10:12:30 with the beats Kuma kept while the collector was silent (one a minute).
    now = new Date(T("10:12:30"));
    const resent = Array.from({ length: 12 }, (_, i) => ({
      ts: T(`10:${String(i + 1).padStart(2, "0")}:00`),
      status: 1 as const,
    }));
    const res = await kuma(resent);
    expect(res.status).toBe(202);
    const out = (await res.json()) as { incidents: { resolved: string[] } };
    expect(out.incidents.resolved).toHaveLength(2);

    const mine = ofSite(cards, "demo");
    expect(mine).toHaveLength(2);
    expect(mine[1]!.components[0].accent_color).toBe(0x22c55e);
    expect(text(mine[1]!).split("\n").slice(0, 7)).toEqual([
      "### ✅ Uptellis: kuma:watch-1 is back",
      "Reporting again; the status page is current.",
      "",
      "**Producer:** Kuma collector on watch-1",
      "**Silent for:** 12 min",
      "**First report again:** 2026-09-27 10:12 UTC",
      "**Beats backfilled for the gap:** 12",
    ]);
    const button = mine[1]!.components[0].components.at(-1);
    expect(button).toEqual({
      type: 1,
      components: [{ type: 2, style: 5, label: "Status page", url: "https://status.example.com/" }],
    });

    const recorded = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.site, "demo"), eq(schema.notifications.status, "sent")));
    expect(recorded.map((r) => r.kind).sort()).toEqual(["open", "resolve"]);
  });
});

describe("POST /api/admin/notify/test", () => {
  const hookEnv = { ...adminEnv, DISCORD_WEBHOOK_URL: HOOK } as Env;

  async function seed() {
    const store = new D1Store(platform);
    await store.syncSources("demo", [
      { id: "kuma:watch-1", kind: "kuma", expectedIntervalS: 60 },
      { id: "facts:app-1", kind: "facts", expectedIntervalS: 900 },
    ]);
    const t = new Date(Date.now() - 30_000).toISOString().replace(/\.\d+Z$/, "Z");
    await store.applyDelta(delta("demo", t, {}));
  }

  const post = async (query: string, e: Env = hookEnv) => {
    const cookie = await adminCookie();
    return handle(
      `/api/admin/notify/test${query}`,
      { method: "POST", headers: { cookie, origin: "https://worker.example.net" } },
      e,
    );
  };

  it("sends a TEST card built from the current state, recording no incident", async () => {
    await seed();
    const { cards } = discord();
    const res = await post("?kind=stale");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      site: "demo",
      source: "kuma:watch-1",
      kind: "stale",
      sent: true,
      status: 200,
      error: null,
    });
    expect(text(cards[0]!)).toContain("### 🚨 TEST: Uptellis: kuma:watch-1 went silent");

    const back = await post("?kind=recovered&source=kuma:watch-1");
    expect(back.status).toBe(200);
    expect(text(cards[1]!)).toContain("### ✅ TEST: Uptellis: kuma:watch-1 is back");
    // The latest real recovery of kuma:watch-1 when there is one (the ingest test above), else a 10 min gap.
    expect(text(cards[1]!)).toMatch(/\*\*Silent for:\*\* 1[02] min/);
    expect((await rows("demo")).filter((r) => r.incidentId.startsWith("test:"))).toEqual([]);
  });

  it("validates the kind, the source and the secret, and reports Discord's refusal", async () => {
    await seed();
    discord(429);
    expect((await post("?kind=down")).status).toBe(400);
    expect((await post("?kind=stale&source=kuma:nowhere")).status).toBe(404);
    expect((await post("?kind=stale&site=nope")).status).toBe(404);
    expect((await post("?kind=stale", adminEnv)).status).toBe(503);
    const refused = await post("?kind=stale");
    expect(refused.status).toBe(502);
    expect(await refused.json()).toMatchObject({ sent: false, status: 429, error: "rate_limited" });
  });

  it("is behind the admin gate", async () => {
    const res = await handle("/api/admin/notify/test?kind=stale", { method: "POST" }, hookEnv);
    expect(res.status).toBe(404);
  });
});
