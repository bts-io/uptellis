/**
 * What the Alerts page shows and saves, as plain functions (no React): channel cards in plain words, a new
 * channel shaped exactly as the full editor shapes one (`newChannel`, `withChannelType`, `withId` from
 * ../ChannelsEditor), and the delivery log as sentences. A channel's id, its secret names and a delivery's
 * incident id are keys only: the cards never render them (secret names appear only in the edit drawer).
 */
import { type ChannelConfig, type ChannelType, NOTIFY_EVENTS, type NotifyEvent } from "@/shared/notify";
import type { Delivery } from "@/shared/schemas/admin";
import { newChannel, withChannelType, withId } from "../ChannelsEditor";
import type { ChannelTestOutcome } from "../client";

/** The type tiles, in the order people reach for them; exactly `CHANNEL_TYPES`. */
export const TILE_ORDER: readonly ChannelType[] = [
  "email",
  "discord",
  "slack",
  "telegram",
  "sms",
  "webhook",
  "ntfy",
];

export const TYPE_NAME: Record<ChannelType, string> = {
  email: "Email",
  discord: "Discord",
  slack: "Slack",
  telegram: "Telegram",
  sms: "SMS",
  webhook: "Webhook",
  ntfy: "ntfy",
};

/** One line under each type tile's fields. */
export const TYPE_HINT: Record<ChannelType, string> = {
  email: "Sent by this instance's email sender (the EMAIL_FROM setting unless you set a sender here).",
  discord: "In Discord: Channel settings, Integrations, Webhooks, New webhook, Copy URL.",
  slack: "Add the Incoming Webhooks app to a Slack channel and copy its webhook URL.",
  telegram: "Add your bot to the chat first, then enter the chat id or @channel name.",
  sms: "Short texts through Twilio, one number per channel. Every text costs money.",
  webhook: "We POST a JSON body to your endpoint, signed when you give a signing key.",
  ntfy: "A push notification on your phone through an ntfy topic (ntfy.sh or your own server).",
};

/** The event chips and checkboxes. */
export const EVENT_WORD: Record<NotifyEvent, string> = {
  down: "Down",
  up: "Back up",
  stale: "Source silent",
  recovered: "Source back",
};

/** The checkbox line under each event in the drawer. */
export const EVENT_HELP: Record<NotifyEvent, string> = {
  down: "A monitor goes down",
  up: "A monitor comes back up",
  stale: "A data source stops reporting",
  recovered: "A data source reports again",
};

/** `ops-slack` from `Ops Slack!`: a channel id from its name (the schema's `[a-z0-9][a-z0-9-]{0,31}`). */
export function slugOf(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
    .replace(/-+$/, "");
  return s || "channel";
}

/** A free channel id for `name` among `taken` (`ops-slack`, then `ops-slack-2`). */
export function freeIdFor(name: string, taken: readonly { id: string }[]): string {
  const base = slugOf(name);
  if (!taken.some((t) => t.id === base)) return base;
  let n = 2;
  while (taken.some((t) => t.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * A new channel of `type` named `name`: the full editor's `newChannel`, switched to `type` and moved to an
 * id made from the name (suggested secret names follow the id), so both editors save the same object.
 */
export function draftChannel(
  type: ChannelType,
  name: string,
  taken: readonly ChannelConfig[],
): ChannelConfig {
  const base = withChannelType(newChannel(taken), type);
  return { ...withId(base, freeIdFor(name, taken)), name };
}

/** The last four digits of a phone number, for a card (the full number stays in the drawer). */
const lastFour = (phone: string) => phone.replace(/\D/g, "").slice(-4);

/** Where a channel sends, in plain words; never a secret's name or value. */
export function destination(ch: ChannelConfig): string {
  switch (ch.type) {
    case "email": {
      const to = ch.to.filter(Boolean);
      return to.length ? `Emails ${to.join(", ")}` : "Emails nobody yet";
    }
    case "discord":
      return "Posts to a Discord channel through its webhook";
    case "slack":
      return "Posts to a Slack channel through its webhook";
    case "telegram":
      return ch.chatId.startsWith("@")
        ? `Posts to the Telegram chat ${ch.chatId}`
        : "Posts to a Telegram chat";
    case "sms":
      return ch.to ? `Texts the number ending in ${lastFour(ch.to)}` : "Texts a phone number";
    case "webhook":
      return ch.signingSecret ? "Sends signed JSON to your endpoint" : "Sends JSON to your endpoint";
    case "ntfy":
      return "Pushes to an ntfy topic";
  }
}

/** Which monitors a channel covers, by name: "All monitors" or "Only API health and Web app". */
export function coverage(ch: ChannelConfig, names: ReadonlyMap<string, string>): string {
  if (ch.services.length === 0) return "All monitors";
  const list = ch.services.map((id) => names.get(id) ?? "a removed monitor");
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
  return `Only ${joined}`;
}

/** The event a test sends: down when the channel wants it, else its first event. */
export const testKindOf = (ch: ChannelConfig): NotifyEvent =>
  ch.events.includes("down") ? "down" : (ch.events[0] ?? NOTIFY_EVENTS[0]);

/** A failure code in plain words (`http_404` reads "the address answered 404"). */
export function failureWords(code: string | null): string {
  if (!code) return "it failed";
  const http = /^http_(\d{3})$/.exec(code);
  if (http) return `the address answered ${http[1]}`;
  const known: Record<string, string> = {
    timeout: "it timed out",
    network: "the request did not get through",
    email_unavailable: "no email sender is set up on this instance",
    secret_missing: "its secret is not set on the server",
    no_channel: "the channel is not saved yet",
    channel_gone: "the channel was removed",
    email_error: "the email sender refused it",
    invalid_message: "the service refused the message",
    incident_gone: "the incident was removed",
    not_found: "the channel is not saved yet",
  };
  return known[code] ?? `it failed (${code})`;
}

/** The toast after "Send test". */
export function testToast(
  name: string,
  outcome: ChannelTestOutcome,
): { message: string; tone: "ok" | "error" } {
  if (outcome.sent) return { message: `Test alert sent to ${name}. It is marked as a test.`, tone: "ok" };
  return {
    message: `The test to ${name} did not go through: ${failureWords(outcome.error)}.`,
    tone: "error",
  };
}

/** What the incident behind a delivery was about, from the known service and source ids. */
export interface Subjects {
  services: ReadonlyMap<string, string>;
  sources: ReadonlyMap<string, string>;
}

function subjectOf(
  incidentId: string,
  subjects: Subjects,
): { kind: "service" | "source"; name: string } | null {
  const hit = (id: string) => incidentId.startsWith(`${id}:`) || incidentId.includes(`:${id}:`);
  // Longest ids first, so `kuma:10` never matches as `kuma:1`.
  const sorted = (m: ReadonlyMap<string, string>) => [...m].sort((a, b) => b[0].length - a[0].length);
  for (const [id, name] of sorted(subjects.services)) if (hit(id)) return { kind: "service", name };
  for (const [id, name] of sorted(subjects.sources)) if (hit(id)) return { kind: "source", name };
  return null;
}

/** "Replica Postgres went down", "Uptime Kuma (watch-1) went silent": a delivery's incident in words. */
export function deliverySentence(
  d: Pick<Delivery, "incidentId" | "kind" | "subject">,
  subjects: Subjects,
): string {
  const opened = d.kind !== "resolve";
  const s = subjectOf(d.incidentId, subjects);
  // Nothing the site knows any more: a removed source when the log says so, else a removed service.
  if (!s && d.subject === "source")
    return opened ? "A removed source went silent" : "A removed source is reporting again";
  if (!s) return opened ? "A removed service went down" : "A removed service came back";
  if (s.kind === "source") return opened ? `${s.name} went silent` : `${s.name} is reporting again`;
  return opened ? `${s.name} went down` : `${s.name} is back up`;
}

export interface AlertGroup {
  key: string;
  /** True for a down or silent alert, false for a recovery. */
  opened: boolean;
  sentence: string;
  at: string;
  /** Channel names it went to, and the ones that failed with why. */
  sent: string[];
  pending: string[];
  failed: { name: string; why: string; retrying: boolean }[];
}

const deliveredAt = (d: Delivery) => d.sentAt ?? d.lastAttemptAt ?? d.createdAt;

/** The delivery log as alerts: one entry per incident change, with where it went, newest first. */
export function groupDeliveries(
  deliveries: readonly Delivery[],
  channelNames: ReadonlyMap<string, string>,
  subjects: Subjects,
): AlertGroup[] {
  const groups = new Map<string, AlertGroup>();
  for (const d of deliveries) {
    const key = `${d.incidentId}|${d.kind}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        opened: d.kind !== "resolve",
        sentence: deliverySentence(d, subjects),
        at: deliveredAt(d),
        sent: [],
        pending: [],
        failed: [],
      };
      groups.set(key, g);
    }
    if (deliveredAt(d) > g.at) g.at = deliveredAt(d);
    const name = channelNames.get(d.channel) ?? "a removed channel";
    if (d.status === "sent") g.sent.push(name);
    else if (d.status === "pending") g.pending.push(name);
    else g.failed.push({ name, why: failureWords(d.error), retrying: d.retryable === true });
  }
  return [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** "Sent to Ops Slack and Discord. Failed for Pager: the address answered 503 (trying again)." */
export function groupSummary(g: AlertGroup): string {
  const list = (xs: string[]) =>
    xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
  const parts: string[] = [];
  if (g.sent.length) parts.push(`Sent to ${list(g.sent)}.`);
  if (g.pending.length) parts.push(`Sending to ${list(g.pending)}.`);
  for (const f of g.failed)
    parts.push(`Not delivered to ${f.name}: ${f.why}${f.retrying ? " (trying again)" : ""}.`);
  return parts.join(" ");
}

/** The newest delivery to each channel, for "Last alert" on its card. */
export function lastByChannel(deliveries: readonly Delivery[]): Map<string, Delivery> {
  const out = new Map<string, Delivery>();
  for (const d of deliveries) {
    const seen = out.get(d.channel);
    if (!seen || deliveredAt(d) > deliveredAt(seen)) out.set(d.channel, d);
  }
  return out;
}

export { deliveredAt };
