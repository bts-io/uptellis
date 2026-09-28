import { and, eq, like } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { SiteConfig } from "@/shared/config";
import { MaintenanceWindow } from "@/shared/monitors";
import { randomNonce, signRequest } from "@/shared/signing";
import { type AppEnv, platformContext } from "@/worker/app-env";
import { schema } from "@/worker/db";
import { type ConfigSource, seedConfigs } from "@/worker/engine/sites";
import { appBackend } from "@/worker/index";
import { ingestRoutes } from "@/worker/ingest/routes";
import { IncidentNotifier } from "@/worker/notify";
import type { DiscordCard } from "@/worker/notify/card";
import { fetchWith, testPlatform, workerEnv } from "../support/platform";

// Never a real webhook: the notifier posts through the fake sender below.
const HOOK = "https://discord.test/api/webhooks/1/test";
const ORIGIN = "https://worker.example.net";
// The tests share one database: each runs on its own day, after the previous one's.
let day = "2026-09-27";
const T = (hms: string) => `${day}T${hms}Z`;
const db = testPlatform().db;

const text = (card: DiscordCard) =>
  card.components[0].components.flatMap((c) => (c.type === 10 ? [c.content] : [])).join("\n");

/**
 * The ingest routes for the demo site with `notify.discord` on (plus `edit`), every card recorded by a fake
 * webhook sender, and a clock the test moves.
 */
function harness(onDay: string, edit: (c: SiteConfig) => SiteConfig = (c) => c) {
  day = onDay;
  const cards: DiscordCard[] = [];
  const sender: typeof fetch = async (_input, init) => {
    cards.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "1" });
  };
  const configs: ConfigSource = {
    current: async (slug) => {
      const state = await seedConfigs.current(slug);
      if (!state) return null;
      return {
        ...state,
        config: edit({ ...state.config, notify: { discord: true, webhooks: [], channels: [] } }),
      };
    },
    slugs: seedConfigs.slugs,
  };
  const clock = { now: new Date(T("10:00:00")) };
  const app = new Hono<AppEnv>().use(platformContext);
  app.route(
    "/api/ingest",
    ingestRoutes(
      (platform, keys) => ({
        ...appBackend(platform, keys),
        configs,
        notifier: new IncidentNotifier({
          db: platform.db,
          configs,
          webhookUrl: HOOK,
          waitUntil: (p) => platform.waitUntil(p),
          send: { fetch: sender },
          now: () => clock.now.getTime(),
        }),
      }),
      { now: () => clock.now },
    ),
  );

  /** A signed Kuma snapshot from the collector at `at`, with one monitor and these beats. */
  async function kuma(at: string, beats: { ts: string; status: 0 | 1; msg?: string }[]) {
    clock.now = new Date(T(at));
    const body = JSON.stringify({
      v: 1,
      generatedAt: clock.now.toISOString(),
      host: "watch-1",
      reachable: true,
      kuma: { version: null, latestVersion: null, dbSizeBytes: null, timezone: null },
      monitors: [
        {
          id: 1,
          name: "Forgejo",
          type: "http",
          url: "https://git.example.org",
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
        ts: T(b.ts),
        status: b.status,
        pingMs: b.status ? 90 : null,
        msg: b.msg ?? null,
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
      clock.now,
      randomNonce(),
    );
    const res = await fetchWith(
      app,
      new Request(`${ORIGIN}${path}`, {
        method: "POST",
        body,
        headers: { "content-type": "application/json", ...headers },
      }),
      { DISCORD_WEBHOOK_URL: HOOK },
    );
    expect(res.status).toBe(202);
    return (await res.json()) as { incidents: { opened: string[]; resolved: string[] } };
  }

  return { cards, kuma };
}

/** Notification rows of the demo site's incidents that started on the current day. */
const dayRows = async () =>
  (
    await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.site, "demo"), like(schema.notifications.incidentId, `%${day}%`)))
  ).map((r) => `${r.kind}:${r.status}`);

describe("down and up cards from ingest", () => {
  it("posts exactly one down card and one up card for one outage", async () => {
    const { cards, kuma } = harness("2026-09-27");

    const opened = await kuma("10:00:00", [{ ts: "09:59:30", status: 0, msg: "HTTP 503" }]);
    expect(opened.incidents.opened).toHaveLength(1);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.components[0].accent_color).toBe(0xdc2626);
    expect(text(cards[0]!)).toMatch(/^### 🔴 Uptellis: .+ is down\n/);
    expect(text(cards[0]!)).toContain("**Service:** kuma:1");
    expect(text(cards[0]!)).toContain("**Checked by:** Kuma collector on watch-1");
    expect(text(cards[0]!)).toContain("**Down since:** 2026-09-27 09:59 UTC (under 1 min ago)");
    expect(text(cards[0]!)).toContain("**Reason:** HTTP 503");

    // Still down on the next reports: the incident stays open, no second card.
    await kuma("10:01:00", [{ ts: "10:00:30", status: 0, msg: "HTTP 503" }]);
    await kuma("10:02:00", [{ ts: "10:01:30", status: 0, msg: "HTTP 503" }]);
    expect(cards).toHaveLength(1);

    const up = await kuma("10:43:00", [{ ts: "10:42:30", status: 1 }]);
    expect(up.incidents.resolved).toHaveLength(1);
    expect(cards).toHaveLength(2);
    expect(cards[1]!.components[0].accent_color).toBe(0x22c55e);
    expect(text(cards[1]!)).toMatch(/^### ✅ Uptellis: .+ is back up\n/);
    expect(text(cards[1]!)).toContain("**Down for:** 43 min");
    expect(text(cards[1]!)).toContain("**Back up:** 2026-09-27 10:42 UTC");

    // Up again and again: nothing more.
    await kuma("10:44:00", [{ ts: "10:43:30", status: 1 }]);
    expect(cards).toHaveLength(2);
    expect((await dayRows()).sort()).toEqual(["open:sent", "resolve:sent"]);
  });

  it("sends nothing for an outage that starts inside a maintenance window, not even the up card", async () => {
    day = "2026-09-28";
    const window = MaintenanceWindow.parse({
      kind: "once",
      id: "upgrade",
      title: "Forgejo upgrade",
      services: ["kuma:1"],
      start: T("09:30:00"),
      end: T("10:30:00"),
    });
    const { cards, kuma } = harness(day, (c) => ({ ...c, maintenance: [window] }));

    const opened = await kuma("10:00:00", [{ ts: "09:59:30", status: 0 }]);
    expect(opened.incidents.opened).toHaveLength(1);
    // Resolved after the window ended: the down card was never sent, so no up card either.
    const up = await kuma("10:43:00", [{ ts: "10:42:30", status: 1 }]);
    expect(up.incidents.resolved).toHaveLength(1);
    expect(cards).toEqual([]);
    expect(await dayRows()).toEqual([]);
  });

  it("sends nothing for down and up when the site leaves notify.discord off", async () => {
    const { cards, kuma } = harness("2026-09-29", (c) => ({
      ...c,
      notify: { discord: false, webhooks: [], channels: [] },
    }));
    await kuma("10:00:00", [{ ts: "09:59:30", status: 0 }]);
    await kuma("10:43:00", [{ ts: "10:42:30", status: 1 }]);
    expect(cards).toEqual([]);
    expect(await dayRows()).toEqual([]);
  });
});
