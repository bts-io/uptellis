/**
 * Down and up cards for a push monitor through the notification dispatcher, in workerd over D1: a
 * `status=down` push opens the incident and sends one down card, the next push sends the up card; the
 * silent rule's down (no push for interval plus grace) sends one down card however many minutes it stays
 * silent; inside a maintenance window nothing is sent. Every card goes to a fake Discord sender.
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { parseSiteConfig, type SiteConfig } from "@/shared/config";
import { MaintenanceWindow, MonitorConfig } from "@/shared/monitors";
import { type AppEnv, platformContext } from "@/worker/app-env";
import type { ConfigSource } from "@/worker/engine/sites";
import { seedConfig } from "@/worker/engine/sites";
import { monitorsBackend } from "@/worker/index";
import { watchPushMonitors } from "@/worker/monitors/push";
import { PushTokenStore } from "@/worker/monitors/push-store";
import { IncidentNotifier } from "@/worker/notify";
import type { DiscordCard } from "@/worker/notify/card";
import { pushRoutes } from "@/worker/routes/push";
import { fetchWith, testPlatform } from "../support/platform";

// Never a real webhook: the notifier posts through the fake sender below.
const HOOK = "https://discord.test/api/webhooks/1/push";
const ORIGIN = "https://worker.example.net";
const platform = testPlatform();

const text = (card: DiscordCard) =>
  card.components[0].components.flatMap((c) => (c.type === 10 ? [c.content] : [])).join("\n");

/** A site with one push monitor (every minute, one minute grace) and Discord cards on. */
function siteConfig(slug: string, maintenance: unknown[] = []): SiteConfig {
  const demo = seedConfig("demo")!;
  return parseSiteConfig({
    ...demo,
    slug,
    hostnames: [`${slug}.example.org`],
    sources: [],
    probes: [],
    monitors: [
      MonitorConfig.parse({ id: "backup", name: "Nightly backup", type: "push", intervalS: 60, graceS: 60 }),
    ],
    maintenance,
    notify: { discord: true, channels: [] },
    sections: [{ id: "jobs", title: "Jobs", services: ["probe:backup"] }],
    displayNames: {},
  });
}

/** The push route and the silent rule for one site, a clock the test moves and every card recorded. */
async function harness(slug: string, day: string, maintenance: unknown[] = []) {
  const T = (hms: string) => Date.parse(`${day}T${hms}Z`);
  const config = siteConfig(slug, maintenance);
  const configs: ConfigSource = {
    current: async (s) =>
      s === slug ? { config, version: 1, savedAt: "1970-01-01T00:00:00Z", savedBy: "test" } : null,
    slugs: async () => [slug],
  };
  const cards: DiscordCard[] = [];
  const pending: Promise<unknown>[] = [];
  const clock = { now: T("10:00:00") };
  const notifier = new IncidentNotifier({
    db: platform.db,
    configs,
    secret: (name) => (name === "DISCORD_WEBHOOK_URL" ? HOOK : undefined),
    waitUntil: (p) => void pending.push(p),
    fetch: async (_input, init) => {
      cards.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "1" });
    },
    now: () => clock.now,
  });
  const backend = { ...monitorsBackend(platform), configs, notifier };
  const app = new Hono<AppEnv>().use(platformContext);
  app.route(
    "/api/push",
    pushRoutes(() => backend, { now: () => new Date(clock.now) }),
  );
  const { token } = await new PushTokenStore(platform).issue(slug, "backup", 1, clock.now);

  const drain = async () => {
    while (pending.length > 0) await Promise.allSettled(pending.splice(0));
  };
  /** A push at `hms`. */
  const push = async (hms: string, query: string) => {
    clock.now = T(hms);
    const res = await fetchWith(app, new Request(`${ORIGIN}/api/push/${token}${query}`), {
      PUSH_RATE_LIMIT: undefined,
    } as unknown as Partial<Env>);
    expect(res.status).toBe(200);
    await drain();
  };
  /** The every-minute silent rule at `hms`. */
  const tick = async (hms: string) => {
    clock.now = T(hms);
    const out = await watchPushMonitors(
      { ...backend, pushes: new PushTokenStore(platform) },
      "cloudflare",
      clock.now,
    );
    await drain();
    return out;
  };
  return { cards, push, tick };
}

describe("cards for a push monitor", () => {
  it("sends one down card for a down push and one up card for the next push", async () => {
    const { cards, push } = await harness("t-push-cards", "2026-09-25");
    await push("10:00:00", "?status=down&msg=disk%20full");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.components[0].accent_color).toBe(0xdc2626);
    expect(text(cards[0]!)).toMatch(/^### 🔴 Uptellis: Nightly backup is down\n/);
    expect(text(cards[0]!)).toContain("**Service:** probe:backup");
    expect(text(cards[0]!)).toContain("**Checked by:** calls to its push URL");
    expect(text(cards[0]!)).toContain("**Reason:** disk full");

    // Still down on the next push: no second card.
    await push("10:00:30", "?status=down&msg=disk%20full");
    expect(cards).toHaveLength(1);

    await push("10:05:00", "?status=up&msg=OK");
    expect(cards).toHaveLength(2);
    expect(text(cards[1]!)).toMatch(/^### ✅ Uptellis: Nightly backup is back up\n/);
    expect(text(cards[1]!)).toContain("**Down for:** 5 min");
  });

  it("sends one down card when the pushes stop and one up card when they come back", async () => {
    const { cards, push, tick } = await harness("t-push-silent-cards", "2026-09-25");
    await tick("10:00:00");
    await push("10:00:20", "?status=up");
    for (const hms of ["10:01:00", "10:02:00"]) expect((await tick(hms)).down).toBe(0);
    // Two minutes (interval plus grace) after the last push.
    expect((await tick("10:03:00")).down).toBe(1);
    expect(cards).toHaveLength(1);
    expect(text(cards[0]!)).toMatch(/is down\n/);
    expect(text(cards[0]!)).toContain("**Reason:** no push for 2 min");
    for (const hms of ["10:04:00", "10:05:00", "10:06:00", "10:07:00"]) await tick(hms);
    expect(cards).toHaveLength(1);

    await push("10:08:10", "?status=up&msg=OK");
    expect(cards).toHaveLength(2);
    expect(text(cards[1]!)).toMatch(/is back up\n/);
  });

  it("sends nothing while a maintenance window covers the silence or a down push", async () => {
    const window = MaintenanceWindow.parse({
      kind: "once",
      id: "backup-work",
      title: "Backup server work",
      services: ["probe:backup"],
      start: "2026-09-26T09:30:00Z",
      end: "2026-09-26T11:00:00Z",
    });
    const { cards, push, tick } = await harness("t-push-maint-cards", "2026-09-26", [window]);
    await tick("10:00:00");
    await push("10:00:20", "?status=up");
    expect((await tick("10:03:00")).down).toBe(1);
    await push("10:05:00", "?status=down&msg=disk%20full");
    for (const hms of ["10:06:00", "10:07:00"]) await tick(hms);
    await push("10:08:00", "?status=up");
    expect(cards).toEqual([]);
  });
});
