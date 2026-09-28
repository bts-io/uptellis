import { describe, expect, it } from "vitest";
import { parseSiteConfig } from "@/shared/config";
import {
  AlertMessage,
  ChannelConfig,
  channelsOf,
  channelWants,
  signWebhook,
  verifyWebhook,
  WEBHOOK_TOLERANCE_S,
} from "@/shared/notify";
import { PublicSummary } from "@/shared/public/summary";

const base = {
  v: 1,
  slug: "acme",
  name: "Acme",
  hostnames: ["status.acme.example"],
  theme: "a-sys-status",
  sources: [],
  sections: [],
  branding: { title: "Acme" },
};

const slack = { id: "ops", name: "Ops", type: "slack", secret: "NOTIFY_SLACK_OPS" } as const;

describe("channels", () => {
  it("keeps the historical Discord behaviour as an implicit channel", () => {
    const off = channelsOf({ discord: false, channels: [] });
    expect(off).toHaveLength(1);
    expect(off[0]).toMatchObject({
      id: "discord",
      secret: "DISCORD_WEBHOOK_URL",
      events: ["stale", "recovered"],
    });
    expect(channelsOf({ discord: true, channels: [] })[0]!.events).toEqual([
      "down",
      "up",
      "stale",
      "recovered",
    ]);
  });

  it("adds nothing when a configured channel already uses the Discord secret", () => {
    const own = ChannelConfig.parse({
      id: "main",
      name: "Main",
      type: "discord",
      secret: "DISCORD_WEBHOOK_URL",
    });
    expect(channelsOf({ discord: true, channels: [own] })).toEqual([own]);
    const withSlack = channelsOf({ discord: false, channels: [ChannelConfig.parse(slack)] });
    expect(withSlack.map((c) => c.id)).toEqual(["ops", "discord"]);
  });

  it("filters by event, by service for service events, and by enabled", () => {
    const c = ChannelConfig.parse({ ...slack, events: ["down", "up"], services: ["probe:web"] });
    expect(channelWants(c, "down", "probe:web")).toBe(true);
    expect(channelWants(c, "down", "probe:db")).toBe(false);
    expect(channelWants(c, "stale", null)).toBe(false);
    const all = ChannelConfig.parse(slack);
    expect(channelWants(all, "stale", null)).toBe(true);
    expect(channelWants({ ...all, enabled: false }, "down", "probe:web")).toBe(false);
  });

  it("names secrets only, never values, and validates each type's fields", () => {
    expect(ChannelConfig.safeParse({ ...slack, secret: "https://hooks.slack.com/x" }).success).toBe(false);
    expect(ChannelConfig.safeParse({ ...slack, secret: "PATH" }).success).toBe(false);
    const tg = { id: "tg", name: "TG", type: "telegram", secret: "NOTIFY_TG_BOT" };
    expect(ChannelConfig.safeParse({ ...tg, chatId: "-1001234567890" }).success).toBe(true);
    expect(ChannelConfig.safeParse({ ...tg, chatId: "@ops_alerts" }).success).toBe(true);
    expect(ChannelConfig.safeParse({ ...tg, chatId: "ops alerts" }).success).toBe(false);
    const mail = { id: "mail", name: "Mail", type: "email" };
    expect(ChannelConfig.safeParse({ ...mail, to: [["ops", "example.org"].join("@")] }).success).toBe(true);
    expect(ChannelConfig.safeParse({ ...mail, to: [] }).success).toBe(false);
    expect(
      ChannelConfig.safeParse({ id: "h", name: "H", type: "webhook", secret: "NOTIFY_HOOK" }).success,
    ).toBe(false);
  });

  it("rejects duplicate channel ids in a site config", () => {
    expect(() => parseSiteConfig({ ...base, notify: { channels: [slack, slack] } })).toThrow(
      /Duplicate channel ops/,
    );
    expect(parseSiteConfig({ ...base, notify: { channels: [slack] } }).notify.channels).toHaveLength(1);
  });
});

describe("signed webhook", () => {
  const body = JSON.stringify({ v: 1, event: "down" });
  it("verifies its own signature and rejects tampering, a wrong key and a stale timestamp", async () => {
    const t = 1_790_000_000;
    const header = await signWebhook("s3cret", body, t);
    expect(header).toMatch(/^t=1790000000,v1=[0-9a-f]{64}$/);
    expect(await verifyWebhook("s3cret", body, header, t + 10)).toBe(true);
    expect(await verifyWebhook("s3cret", `${body} `, header, t)).toBe(false);
    expect(await verifyWebhook("other", body, header, t)).toBe(false);
    expect(await verifyWebhook("s3cret", body, header, t + WEBHOOK_TOLERANCE_S + 1)).toBe(false);
    expect(await verifyWebhook("s3cret", body, "garbage", t)).toBe(false);
  });
});

describe("messages and summaries", () => {
  it("parses a down alert and refuses an address in a text field", () => {
    const msg = {
      v: 1,
      event: "down",
      severity: "critical",
      incidentId: "probe:web:2026-09-28T12:00:00Z",
      site: { slug: "acme", name: "Acme" },
      subject: {
        kind: "service",
        id: "probe:web",
        name: "Web",
        target: "example.org/",
        reporter: "Cloudflare edge",
      },
      title: "Web is down",
      reason: "HTTP 503",
      startedAt: "2026-09-28T12:00:00Z",
      endedAt: null,
      durationS: null,
      pageUrl: "https://status.example.org/",
      test: false,
      sentAt: "2026-09-28T12:00:05Z",
    };
    expect(AlertMessage.safeParse(msg).success).toBe(true);
    const leaked = { ...msg, reason: ["connect", [10, 0, 0, 7].join(".")].join(" ") };
    expect(AlertMessage.safeParse(leaked).success).toBe(false);
  });

  it("keeps parts that are not shared absent", () => {
    const s = PublicSummary.parse({ v: 1, site: { slug: "acme", name: "Acme" } });
    expect(Object.keys(s)).toEqual(["v", "site"]);
    const full = PublicSummary.parse({
      v: 1,
      site: { slug: "acme", name: "Acme" },
      verdict: { state: "operational", label: "All systems operational" },
      sections: [
        {
          id: "web",
          title: "Web",
          services: [{ id: "probe:web", state: "up", name: "Web", uptime90d: 0.999 }],
        },
      ],
      generatedAt: "2026-09-28T12:00:00Z",
    });
    expect(full.sections?.[0]?.services[0]?.uptime90d).toBe(0.999);
  });
});
