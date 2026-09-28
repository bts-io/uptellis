import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSiteConfig, type SiteConfig } from "@/shared/config";
import type { Incident } from "@/shared/model";
import { MaintenanceWindow } from "@/shared/monitors";
import { type OutgoingEmail, SIGNATURE_HEADER, verifyWebhook } from "@/shared/notify";
import { runJob } from "@/worker/cron";
import { schema } from "@/worker/db";
import { D1Store } from "@/worker/engine/d1-store";
import type { ConfigSource } from "@/worker/engine/sites";
import { IncidentNotifier, type NotifierDeps } from "@/worker/notify";
import { testPlatform } from "../support/platform";
import { adminCookie, adminEnv, handle } from "./admin-app";
import { beat, delta, service } from "./storage-helpers";

// Never real endpoints: every request goes to the fake fetch of each test.
const SECRETS: Record<string, string> = {
  DISCORD_WEBHOOK_URL: "https://discord.test/api/webhooks/1/test",
  NOTIFY_SLACK: "https://slack.test/services/x",
  NOTIFY_HOOK: "https://receiver.test/uptellis",
  NOTIFY_SIGN: "test-signing-secret",
};
const HOSTS = { "discord.test": "discord", "slack.test": "slack", "receiver.test": "webhook" } as const;
type Service = (typeof HOSTS)[keyof typeof HOSTS];
const addr = (user: string) => [user, "example.org"].join("@");

const platform = testPlatform();
const db = platform.db;
let day = "2026-10-01";
const T = (hms: string) => `${day}T${hms}Z`;
const at = (hms: string) => Date.parse(T(hms));

afterEach(() => vi.restoreAllMocks());

const CHANNELS = [
  { id: "ops", name: "Ops Slack", type: "slack", secret: "NOTIFY_SLACK" },
  { id: "hook", name: "Receiver", type: "webhook", secret: "NOTIFY_HOOK", signingSecret: "NOTIFY_SIGN" },
  { id: "mail", name: "Mail", type: "email", to: [addr("ops")] },
  { id: "tg", name: "Telegram", type: "telegram", secret: "NOTIFY_TG", chatId: "-100123", events: ["stale"] },
  { id: "other", name: "Other", type: "slack", secret: "NOTIFY_SLACK", services: ["kuma:9"] },
];

function siteConfig(slug: string, extra: Record<string, unknown> = {}): SiteConfig {
  return parseSiteConfig({
    v: 1,
    slug,
    name: "Channel Test",
    hostnames: ["status.example.com"],
    theme: "a-sys-status",
    sources: [],
    sections: [],
    branding: { title: "Channel Test" },
    notify: { discord: true, channels: CHANNELS },
    ...extra,
  });
}

/**
 * A notifier over the test D1 for one site's config, a fake fetch that answers per service (`answers`
 * lists statuses to return in turn, then 200), a fake email sender and a recording sleep.
 */
function harness(config: SiteConfig, answers: Partial<Record<Service, number[]>> = {}, secrets = SECRETS) {
  const posts: { to: Service; headers: Headers; body: string }[] = [];
  const emails: OutgoingEmail[] = [];
  const sleeps: number[] = [];
  const clock = { now: at("10:00:00") };
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const to = HOSTS[url.hostname as keyof typeof HOSTS];
    if (!to) throw new Error("unexpected fetch");
    posts.push({ to, headers: new Headers(init?.headers), body: String(init?.body) });
    const status = answers[to]?.shift() ?? 200;
    return new Response(status === 204 ? null : "{}", { status });
  });
  const configs: ConfigSource = {
    current: async (slug) => (slug === config.slug ? { config, version: 1 } : null) as never,
    slugs: async () => [config.slug],
  };
  const deps: NotifierDeps = {
    db,
    configs,
    secret: (name) => secrets[name],
    email: {
      send: async (m) => {
        emails.push(m);
        return { ok: true, status: 200 };
      },
    },
    emailFrom: addr("status"),
    fetch,
    sleep: async (ms) => void sleeps.push(ms),
    now: () => clock.now,
  };
  return { notifier: new IncidentNotifier(deps), posts, emails, sleeps, clock };
}

/** Opens and (unless `open`) later resolves a `down` incident of kuma:1 on `site`. */
async function outage(site: string, open = false) {
  const store = new D1Store(platform);
  const down = await store.applyDelta(
    delta(site, T("10:00:00"), {
      services: [service(site, "1", "down", "Checkout")],
      heartbeats: [{ ...beat(site, "kuma:1", T("09:59:30"), "down"), message: "HTTP 503" }],
    }),
  );
  if (open) return { opened: down.incidentsOpened, resolved: [] as Incident[] };
  const up = await store.applyDelta(
    delta(site, T("10:30:00"), {
      services: [service(site, "1", "up", "Checkout")],
      heartbeats: [beat(site, "kuma:1", T("10:29:30"), "up")],
    }),
  );
  expect(down.incidentsOpened.map((i) => i.kind)).toEqual(["down"]);
  expect(up.incidentsResolved.map((i) => i.kind)).toEqual(["down"]);
  return { opened: down.incidentsOpened, resolved: up.incidentsResolved };
}

const rows = async (site: string) =>
  (await db.select().from(schema.notifications).where(eq(schema.notifications.site, site)))
    .map((r) => `${r.channel}:${r.kind}:${r.status}${r.error ? `:${r.error}` : ""}`)
    .sort();

const row = async (site: string, channel: string, kind: "open" | "resolve") =>
  (
    await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.site, site),
          eq(schema.notifications.channel, channel),
          eq(schema.notifications.kind, kind),
        ),
      )
  )[0];

describe("migration 0006", () => {
  it("gives notifications a channel, retry columns and a primary key per channel", async () => {
    const cols = await platform.db.all<{ name: string; pk: number; dflt_value: string | null }>(
      "select name, pk, dflt_value from pragma_table_info('notifications')" as never,
    );
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
    expect(Object.keys(byName)).toEqual(
      expect.arrayContaining(["channel", "attempts", "retryable", "last_attempt_at"]),
    );
    expect(byName.channel?.dflt_value).toBe("'discord'");
    expect(
      cols
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name),
    ).toEqual(["site", "incident_id", "kind", "channel"]);
  });
});

describe("dispatch to channels", () => {
  it("fans one transition out to every channel that wants it, once per channel", async () => {
    day = "2026-10-01";
    const site = "t-chan-fan";
    const { notifier, posts, emails } = harness(siteConfig(site));
    const t = await outage(site);

    await notifier.notify(site, { opened: t.opened, resolved: [] });
    // Slack, the webhook, the implicit Discord (notify.discord) and email; Telegram wants only stale, and
    // "other" only kuma:9.
    expect(posts.map((p) => p.to).sort()).toEqual(["discord", "slack", "webhook"]);
    expect(emails.map((e) => e.subject)).toEqual(["[Uptellis] Checkout is down"]);
    const hook = posts.find((p) => p.to === "webhook")!;
    const message = JSON.parse(hook.body);
    expect(message).toMatchObject({
      event: "down",
      severity: "critical",
      site: { slug: site, name: "Channel Test" },
      subject: { kind: "service", id: "kuma:1", name: "Checkout", reporter: "Kuma collector on watch-1" },
      title: "Checkout is down",
      reason: "HTTP 503",
      pageUrl: "https://status.example.com/",
      test: false,
    });
    expect(
      await verifyWebhook(
        "test-signing-secret",
        hook.body,
        hook.headers.get(SIGNATURE_HEADER)!,
        at("10:00:00") / 1000,
      ),
    ).toBe(true);
    expect(await rows(site)).toEqual([
      "discord:open:sent",
      "hook:open:sent",
      "mail:open:sent",
      "ops:open:sent",
    ]);

    // Handed the same transition again (a retried cron, a concurrent ingest): nothing more.
    await notifier.notify(site, { opened: t.opened, resolved: [] });
    expect(posts).toHaveLength(3);

    await notifier.notify(site, { opened: [], resolved: t.resolved });
    expect(posts.filter((p) => p.to === "webhook").map((p) => JSON.parse(p.body).event)).toEqual([
      "down",
      "up",
    ]);
    expect(posts).toHaveLength(6);
    expect(emails.map((e) => e.subject)).toEqual([
      "[Uptellis] Checkout is down",
      "[Uptellis] Checkout is back up",
    ]);
    expect((await rows(site)).filter((r) => r.includes(":resolve:"))).toEqual([
      "discord:resolve:sent",
      "hook:resolve:sent",
      "mail:resolve:sent",
      "ops:resolve:sent",
    ]);
  });

  it("isolates a failing channel, and sends it no up after its down failed for good", async () => {
    day = "2026-10-02";
    const site = "t-chan-fail";
    const { notifier, posts, emails } = harness(siteConfig(site), { slack: [404] });
    const t = await outage(site);
    await notifier.notify(site, { opened: t.opened, resolved: [] });
    expect(await row(site, "ops", "open")).toMatchObject({
      status: "failed",
      error: "http_404",
      attempts: 1,
      retryable: false,
    });
    expect(await rows(site)).toEqual([
      "discord:open:sent",
      "hook:open:sent",
      "mail:open:sent",
      "ops:open:failed:http_404",
    ]);
    await notifier.notify(site, { opened: [], resolved: t.resolved });
    expect(posts.filter((p) => p.to === "slack")).toHaveLength(1);
    expect(emails).toHaveLength(2);
    expect(await row(site, "ops", "resolve")).toBeUndefined();
  });

  it("retries a retryable failure in the request with backoff, then records the attempts", async () => {
    day = "2026-10-03";
    const site = "t-chan-retry";
    const { notifier, posts, sleeps } = harness(siteConfig(site), { slack: [503, 502] });
    const t = await outage(site);
    await notifier.notify(site, { opened: t.opened, resolved: [] });
    expect(posts.filter((p) => p.to === "slack")).toHaveLength(3);
    expect(sleeps).toEqual([1000, 4000]);
    expect(await row(site, "ops", "open")).toMatchObject({
      status: "sent",
      attempts: 3,
      retryable: false,
      lastAttemptAt: at("10:00:00"),
    });
  });

  it("leaves a still failing delivery to the retry pass, which sends it and gives up on what is gone", async () => {
    day = "2026-10-04";
    const site = "t-chan-later";
    const h = harness(siteConfig(site), { slack: [503, 503, 503] });
    const t = await outage(site, true);
    await h.notifier.notify(site, { opened: t.opened, resolved: [] });
    expect(await row(site, "ops", "open")).toMatchObject({ status: "failed", attempts: 3, retryable: true });
    h.clock.now = at("10:05:00");
    await h.notifier.retryFailed();
    expect(await row(site, "ops", "open")).toMatchObject({
      status: "sent",
      attempts: 4,
      error: null,
      lastAttemptAt: at("10:05:00"),
    });
    expect(h.posts.filter((p) => p.to === "slack")).toHaveLength(4);

    // A retryable failure of a down that resolved since is not sent after the all-clear.
    await new D1Store(platform).applyDelta(
      delta(site, T("10:30:00"), {
        services: [service(site, "1", "up", "Checkout")],
        heartbeats: [beat(site, "kuma:1", T("10:29:30"), "up")],
      }),
    );
    await db
      .update(schema.notifications)
      .set({ status: "failed", retryable: true, error: "http_500" })
      .where(and(eq(schema.notifications.site, site), eq(schema.notifications.channel, "hook")));
    h.clock.now = at("10:35:00");
    await h.notifier.retryFailed();
    expect(await row(site, "hook", "open")).toMatchObject({
      status: "failed",
      error: "superseded",
      retryable: false,
    });

    // After an hour nothing is retried any more.
    const h3 = harness(siteConfig(site), { slack: [503, 503, 503] });
    await db
      .update(schema.notifications)
      .set({ status: "failed", retryable: true, error: "http_503" })
      .where(and(eq(schema.notifications.site, site), eq(schema.notifications.channel, "mail")));
    h3.clock.now = at("11:30:00");
    await h3.notifier.retryFailed();
    expect(h3.emails).toEqual([]);
    expect(await row(site, "mail", "open")).toMatchObject({ status: "failed", retryable: true });
  });

  it("sends no down anywhere for an outage that starts inside a maintenance window", async () => {
    day = "2026-10-05";
    const site = "t-chan-maint";
    const window = MaintenanceWindow.parse({
      kind: "once",
      id: "upgrade",
      title: "Upgrade",
      services: [],
      start: T("09:30:00"),
      end: T("10:15:00"),
    });
    const { notifier, posts, emails } = harness(siteConfig(site, { maintenance: [window] }));
    const t = await outage(site);
    await notifier.notify(site, t);
    expect(posts).toEqual([]);
    expect(emails).toEqual([]);
    expect(await rows(site)).toEqual([]);
  });

  it("skips the implicit Discord channel quietly without its secret, but records a configured one", async () => {
    day = "2026-10-06";
    const site = "t-chan-secret";
    const { DISCORD_WEBHOOK_URL: _, NOTIFY_SLACK: __, ...rest } = SECRETS;
    const config = siteConfig(site, { notify: { discord: true, channels: [CHANNELS[0]] } });
    const { notifier, posts } = harness(config, {}, rest);
    const t = await outage(site);
    await notifier.notify(site, { opened: t.opened, resolved: [] });
    expect(posts).toEqual([]);
    expect(await rows(site)).toEqual(["ops:open:failed:secret_missing"]);
  });

  it("sends a stale and its recovery to the channels that want source events", async () => {
    day = "2026-10-07";
    const site = "t-chan-stale";
    const store = new D1Store(platform);
    await store.applyDelta(delta(site, T("10:00:00"), {}));
    const opened = await store.sweepStaleness(site, T("10:06:00"));
    const { notifier, posts, emails } = harness(
      siteConfig(site, { notify: { discord: false, channels: CHANNELS.slice(0, 3) } }),
    );
    await notifier.notify(site, { opened: opened.incidentsOpened, resolved: [] });
    const card = JSON.parse(posts.find((p) => p.to === "discord")!.body);
    expect(card.components[0].components[0].content).toContain("**Still reporting:** no other source");
    const hook = JSON.parse(posts.find((p) => p.to === "webhook")!.body);
    expect(hook.details.map((d: { label: string }) => d.label)).toEqual([
      "Last report",
      "Expected interval",
      "Still reporting",
    ]);
    expect(emails[0]!.text).toContain("Last report: ");
    expect(posts.map((p) => p.to).sort()).toEqual(["discord", "slack", "webhook"]);
  });
});

describe("the five-minute job", () => {
  it("retries a failed retryable delivery of the last hour", async () => {
    day = "2026-10-08";
    const site = "t-chan-cron";
    const hooked = testPlatform({ DISCORD_WEBHOOK_URL: SECRETS.DISCORD_WEBHOOK_URL });
    const store = new D1Store(platform);
    await store.applyDelta(delta(site, T("10:00:00"), {}));
    const r = await store.sweepStaleness(site, T("10:06:00"));
    const incidentId = r.incidentsOpened[0]!.id;
    await db.insert(schema.notifications).values([
      {
        site,
        incidentId,
        kind: "open",
        channel: "discord",
        status: "failed",
        error: "http_503",
        attempts: 3,
        retryable: true,
        lastAttemptAt: at("10:06:00"),
        createdAt: at("10:06:00"),
      },
      {
        site,
        incidentId: `${incidentId}:old`,
        kind: "open",
        channel: "discord",
        status: "failed",
        error: "http_503",
        attempts: 3,
        retryable: true,
        createdAt: at("08:00:00"),
      },
    ]);
    const cards: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      cards.push(String(init?.body));
      return Response.json({ id: "1" });
    });
    await runJob(hooked, "fiveMinute", at("10:11:00"));
    await hooked.drain();
    expect(cards.filter((c) => c.includes(`-# Uptellis · ${site} ·`))).toHaveLength(1);
    expect(await row(site, "discord", "open")).toMatchObject({ status: "sent", attempts: 4, error: null });
    const old = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.incidentId, `${incidentId}:old`));
    expect(old[0]).toMatchObject({ status: "failed", attempts: 3 });
  });
});

describe("POST /api/admin/notify/test?channel=", () => {
  const hookEnv = { ...adminEnv, DISCORD_WEBHOOK_URL: SECRETS.DISCORD_WEBHOOK_URL } as Env;
  const post = async (query: string, e: Env = hookEnv) =>
    handle(
      `/api/admin/notify/test${query}`,
      { method: "POST", headers: { cookie: await adminCookie(), origin: "https://worker.example.net" } },
      e,
    );

  it("sends a test to a channel of channelsOf and answers with its id; 404 for an unknown one", async () => {
    const store = new D1Store(platform);
    await store.syncSources("demo", [{ id: "kuma:watch-1", kind: "kuma", expectedIntervalS: 60 }]);
    await store.applyDelta(delta("demo", new Date(Date.now() - 30_000).toISOString(), {}));
    const cards: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      cards.push(String(init?.body));
      return Response.json({ id: "1" });
    });
    const res = await post("?site=demo&kind=stale&channel=discord");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      site: "demo",
      channel: "discord",
      kind: "stale",
      sent: true,
      status: 200,
      error: null,
    });
    expect(cards[0]).toContain("TEST: Uptellis: kuma:watch-1 went silent");
    expect((await post("?site=demo&kind=stale&channel=nope")).status).toBe(404);
    // A channel test does not need the legacy secret up front: the provider reports it.
    const missing = await post("?site=demo&kind=stale&channel=discord", adminEnv);
    expect(missing.status).toBe(502);
    expect(await missing.json()).toMatchObject({ channel: "discord", sent: false, error: "secret_missing" });
  });
});
