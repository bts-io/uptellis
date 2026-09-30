/**
 * Phase 6b contract (lead): notification channels in the site config. A channel is one destination (a
 * Discord or Slack webhook, a signed webhook, an ntfy topic, a Telegram chat, email addresses, a phone
 * number for SMS) with the
 * events it wants. Secrets are never in the config: a channel names the Worker secret or env var that holds
 * its URL or token (`NOTIFY_*`, or the historical `DISCORD_WEBHOOK_URL`), read with
 * `Platform.notifySecret`. Email is sent by the instance's sender (`Platform.email`), so an email channel
 * carries only addresses. Changing a shape here needs the lead: every 6b stream codes against it.
 */
import { z } from "zod";
import { ServiceId } from "../model/common";
import { safeDisplay } from "../model/safety";

/** What a channel can be told about: a service going down and back up, a source going silent and back. */
export const NOTIFY_EVENTS = ["down", "up", "stale", "recovered"] as const;
export const NotifyEvent = z.enum(NOTIFY_EVENTS);
export type NotifyEvent = z.infer<typeof NotifyEvent>;

export const CHANNEL_TYPES = ["discord", "slack", "webhook", "ntfy", "telegram", "email", "sms"] as const;
export const ChannelType = z.enum(CHANNEL_TYPES);
export type ChannelType = z.infer<typeof ChannelType>;

/** The historical Discord secret; every other channel secret is `NOTIFY_<NAME>`. */
export const LEGACY_DISCORD_SECRET = "DISCORD_WEBHOOK_URL";

/** A secret or env var name a channel may read (`Platform.notifySecret` refuses any other name). */
export const ChannelSecretName = z
  .string()
  .regex(/^(?:NOTIFY_[A-Z0-9_]{1,56}|DISCORD_WEBHOOK_URL)$/, "Expected a secret name like NOTIFY_SLACK_OPS");
export type ChannelSecretName = z.infer<typeof ChannelSecretName>;

const ChannelId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);
/** A plain mailbox address (no display name). */
const EmailAddress = z.email().max(254);
/** A phone number in E.164 form: `+`, a country code and up to 15 digits in all. */
const E164 = /^\+[1-9]\d{6,14}$/;
/** A Twilio Messaging Service SID. */
const MESSAGING_SERVICE_SID = /^MG[0-9a-f]{32}$/;

const common = {
  id: ChannelId,
  /** Shown in admin and in the delivery log. */
  name: safeDisplay(80),
  events: z
    .array(NotifyEvent)
    .min(1)
    .refine((e) => new Set(e).size === e.length, { message: "Events must be unique" })
    .default([...NOTIFY_EVENTS]),
  /** Only these services (down and up events); empty means every service. Source events always pass. */
  services: z.array(ServiceId).max(100).default([]),
  enabled: z.boolean().default(true),
};

export const ChannelConfig = z.discriminatedUnion("type", [
  /** `secret`: the channel webhook URL. */
  z.object({ ...common, type: z.literal("discord"), secret: ChannelSecretName }),
  /** `secret`: the Slack incoming webhook URL. */
  z.object({ ...common, type: z.literal("slack"), secret: ChannelSecretName }),
  /**
   * `secret`: the endpoint URL; `signingSecret`: an optional HMAC key (src/shared/notify/webhook.ts), without
   * it a plain, unsigned POST; `authSecret`: an optional value sent as the `Authorization` header as is.
   */
  z.object({
    ...common,
    type: z.literal("webhook"),
    secret: ChannelSecretName,
    signingSecret: ChannelSecretName.optional(),
    authSecret: ChannelSecretName.optional(),
  }),
  /** `secret`: the topic URL (`https://ntfy.sh/<topic>` or self-hosted); `tokenSecret`: an optional access token. */
  z.object({
    ...common,
    type: z.literal("ntfy"),
    secret: ChannelSecretName,
    tokenSecret: ChannelSecretName.optional(),
  }),
  /** `secret`: the bot token; `chatId`: the chat, group or channel to post in. */
  z.object({
    ...common,
    type: z.literal("telegram"),
    secret: ChannelSecretName,
    chatId: z.string().regex(/^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/, "Expected a chat id or @channel"),
  }),
  /** Sent by the instance's email sender (`Platform.email`); `from` defaults to the `EMAIL_FROM` setting. */
  z.object({
    ...common,
    type: z.literal("email"),
    to: z.array(EmailAddress).min(1).max(10),
    from: EmailAddress.optional(),
  }),
  /**
   * A text message through Twilio: `secret` holds the account's auth token, `from` is a Twilio number
   * (E.164) or a Messaging Service SID (`MG...`), `to` exactly one E.164 number (a second person is a
   * second channel). Every text costs money, so `events` defaults to `down` and `up`. The numbers are
   * personal data: they never reach a log, the delivery log, an error or a public surface.
   */
  z.object({
    ...common,
    events: common.events.unwrap().default(["down", "up"]),
    type: z.literal("sms"),
    provider: z.literal("twilio"),
    accountSid: z
      .string()
      .regex(/^AC[0-9a-f]{32}$/, "Expected a Twilio Account SID (AC and 32 hex characters)"),
    secret: ChannelSecretName,
    from: z.string().refine((s) => E164.test(s) || MESSAGING_SERVICE_SID.test(s), {
      message: "Expected an E.164 number like +15551234567 or a Messaging Service SID (MG...)",
    }),
    to: z.string().regex(E164, "Expected one E.164 number like +15551234567"),
  }),
]);
export type ChannelConfig = z.infer<typeof ChannelConfig>;
export type ChannelConfigInput = z.input<typeof ChannelConfig>;

/** The id of the channel `channelsOf` adds for the historical Discord behaviour. */
export const LEGACY_DISCORD_CHANNEL = "discord";

/**
 * Every channel of a site: the configured `notify.channels`, plus the historical Discord behaviour when no
 * configured channel uses `DISCORD_WEBHOOK_URL`: a Discord channel on that secret with `stale` and
 * `recovered` always, and `down` and `up` too when `notify.discord` is on. Existing sites therefore keep
 * exactly the cards they had. The dispatcher and admin read channels only through this.
 */
export function channelsOf(notify: {
  discord: boolean;
  channels: readonly ChannelConfig[];
}): ChannelConfig[] {
  const usesLegacy = notify.channels.some((c) => "secret" in c && c.secret === LEGACY_DISCORD_SECRET);
  if (usesLegacy || notify.channels.some((c) => c.id === LEGACY_DISCORD_CHANNEL)) return [...notify.channels];
  const events: NotifyEvent[] = notify.discord ? [...NOTIFY_EVENTS] : ["stale", "recovered"];
  return [
    ...notify.channels,
    ChannelConfig.parse({
      id: LEGACY_DISCORD_CHANNEL,
      name: "Discord",
      type: "discord",
      secret: LEGACY_DISCORD_SECRET,
      events,
    }),
  ];
}

/** Whether `channel` wants `event` for `serviceId` (null for source events). */
export function channelWants(channel: ChannelConfig, event: NotifyEvent, serviceId: string | null): boolean {
  if (!channel.enabled || !channel.events.includes(event)) return false;
  if (serviceId === null || channel.services.length === 0) return true;
  return channel.services.includes(serviceId);
}
