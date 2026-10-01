/**
 * What the first-run screen ("What should we watch?") and the Getting started checklist build and show, as
 * plain functions (no React). The first monitor is shaped exactly as the New monitor drawer shapes one
 * (`draftOf`, `inferType`, `nameFromTarget`, `monitorFromDraft`), the first channel exactly as the
 * channels editor does (`withChannelType`, `suggestedSecret`), and both land in one saved change.
 *
 * Checklist items are computed from what is saved and what the server reports, never stored; only "Hide"
 * is remembered, per browser.
 */
import type { SiteConfig } from "@/shared/config";
import { type MonitorConfig, monitorsOf } from "@/shared/monitors";
import { type ChannelConfig, type ChannelType, NOTIFY_EVENTS } from "@/shared/notify";
import type { ConfigIssue, Delivery } from "@/shared/schemas/admin";
import type { SiteView } from "@/shared/view";
import { suggestedSecret, withChannelType } from "../ChannelsEditor";
import { buildRows, draftOf, inferType, monitorFromDraft, nameFromTarget, upsertMonitor } from "./model";

/* ------------------------------------------------------------------ */
/* First run                                                           */
/* ------------------------------------------------------------------ */

/** The first-run screen's path. */
export const WELCOME_PATH = "/admin/welcome";

/** The note of the one saved change the first-run screen makes. */
export const FIRST_RUN_NOTE = "First monitor and alert channel";

/** Whether the site watches nothing yet: no monitor (a legacy probe included) and no other source's service. */
export const needsWelcome = (config: SiteConfig, view: SiteView | null) =>
  buildRows(config, view).length === 0;

/** The tiles of step 2, in order. */
export const FIRST_CHANNEL_TYPES = [
  "email",
  "discord",
  "slack",
  "telegram",
  "sms",
  "webhook",
  "ntfy",
] as const;

export const TILE_LABEL: Record<ChannelType, string> = {
  email: "Email",
  discord: "Discord",
  slack: "Slack",
  telegram: "Telegram",
  sms: "SMS",
  webhook: "Webhook",
  ntfy: "ntfy",
};

/** What the named secret of each secret-backed type holds, for the one line under its name. */
export const SECRET_HOLDS: Record<Exclude<ChannelType, "email">, string> = {
  discord: "the webhook URL from your Discord channel's settings (Integrations, Webhooks)",
  slack: "the incoming webhook URL from your Slack app",
  webhook: "the address we post each alert to",
  ntfy: "the topic URL, like https://ntfy.sh/your-topic",
  telegram: "the bot token BotFather gave you",
  sms: "your Twilio auth token",
};

/** The one or few values each tile asks for (secrets are never typed here: they live on the server). */
export interface ChannelDraft {
  type: ChannelType;
  /** Email: addresses, separated by commas or spaces. */
  emails: string;
  /** Telegram: the chat id or @channel. */
  chatId: string;
  /** SMS: the number to text, the Twilio number or Messaging Service SID to send from, the Account SID. */
  smsTo: string;
  smsFrom: string;
  accountSid: string;
}

export const emptyChannelDraft = (type: ChannelType = "email"): ChannelDraft => ({
  type,
  emails: "",
  chatId: "",
  smsTo: "",
  smsFrom: "",
  accountSid: "",
});

/** `alerts-slack`, or `alerts-slack-2` when that is taken. */
export function firstChannelId(type: ChannelType, taken: readonly { id: string }[]): string {
  const base = `alerts-${type}`;
  if (!taken.some((t) => t.id === base)) return base;
  let n = 2;
  while (taken.some((t) => t.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** The addresses typed in the email field. */
export const splitEmails = (raw: string) => raw.split(/[\s,;]+/).filter(Boolean);

/** The channel the draft describes, named after its type, alerting on every event for every service. */
export function channelFromDraft(d: ChannelDraft, taken: readonly ChannelConfig[]): ChannelConfig {
  const id = firstChannelId(d.type, taken);
  const start: ChannelConfig = {
    id,
    name: TILE_LABEL[d.type],
    type: "discord",
    secret: suggestedSecret(id),
    events: [...NOTIFY_EVENTS],
    services: [],
    enabled: true,
  };
  const ch = withChannelType(start, d.type);
  switch (ch.type) {
    case "email":
      return { ...ch, to: splitEmails(d.emails) };
    case "telegram":
      return { ...ch, chatId: d.chatId.trim() };
    case "sms":
      return {
        ...ch,
        to: d.smsTo.replace(/[\s()-]/g, ""),
        from: d.smsFrom.trim(),
        accountSid: d.accountSid.trim(),
      };
    default:
      return ch;
  }
}

/** The monitor for what was typed in step 1: the type and name inferred as the New monitor drawer does. */
export function monitorFromAddress(raw: string, taken: readonly MonitorConfig[]): MonitorConfig {
  return monitorFromDraft(
    null,
    { ...draftOf(null), target: raw, type: inferType(raw), name: nameFromTarget(raw) },
    taken,
  );
}

/** Adds the monitor and the channel in one change. */
export const firstRunChange =
  (monitor: MonitorConfig, channel: ChannelConfig) =>
  (c: SiteConfig): SiteConfig => {
    const next = upsertMonitor(monitor)(c);
    return { ...next, notify: { ...next.notify, channels: [...next.notify.channels, channel] } };
  };

/** A channel issue in plain words, by the field it belongs to. */
export function plainChannelIssue(issue: ConfigIssue, type: ChannelType): string {
  const field = issue.path.split(".")[3] ?? "";
  if (type === "email") return "Enter one or more email addresses, separated by commas.";
  if (field === "chatId") return "Enter the chat ID (a number like -1001234567890) or the channel's @name.";
  if (field === "to") return "Enter the phone number with its country code, like +15551234567.";
  if (field === "from") return "Enter a Twilio number like +15551234567, or a Messaging Service SID (MG...).";
  if (field === "accountSid") return "Enter the Twilio Account SID: AC followed by 32 letters and digits.";
  return issue.message;
}

/* ------------------------------------------------------------------ */
/* Getting started                                                     */
/* ------------------------------------------------------------------ */

export type ChecklistKey = "monitor" | "channel" | "test" | "heartbeat" | "page" | "invite";

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  done: boolean;
  /** Where the item's link goes (an admin path); absent for an item done by a button here. */
  to?: string;
}

export interface ChecklistFacts {
  /** The delivery log, or null when it could not be read. */
  deliveries: readonly Delivery[] | null;
  /** How many people can sign in, or null when this user cannot see the list (the item is left out). */
  users: number | null;
  /** A test alert went through from this page, or earlier in this browser (`testAlertSent`). */
  testSent: boolean;
}

/** A test alert's incident id starts with `test:` (src/worker/notify, `testIncident`). */
const isTest = (d: Delivery) => d.incidentId.startsWith("test:");

/** The Getting started items, ticked from the saved config and what the server reports. */
export function checklistItems(config: SiteConfig, facts: ChecklistFacts): ChecklistItem[] {
  const monitors = monitorsOf(config);
  const items: ChecklistItem[] = [
    { key: "monitor", label: "Add your first monitor", done: monitors.length > 0, to: WELCOME_PATH },
    {
      key: "channel",
      label: "Choose where alerts go",
      done: config.notify.channels.length > 0 || config.notify.discord,
      to: "/admin/alerts",
    },
    {
      key: "test",
      label: "Send a test alert",
      done: facts.testSent || (facts.deliveries ?? []).some(isTest),
    },
    {
      key: "heartbeat",
      label: "Add a heartbeat for a cron job",
      done: monitors.some((m) => m.type === "push"),
    },
    {
      key: "page",
      label: "Put monitors on your status page",
      done: config.sections.some((s) => s.services.length > 0),
      to: "/admin/status-page",
    },
  ];
  if (facts.users !== null)
    items.push({
      key: "invite",
      label: "Invite a teammate",
      done: facts.users > 1,
      to: "/admin/settings/users",
    });
  return items;
}

const hiddenKey = (site: string) => `uptellis:getting-started-hidden:${site}`;

/** Whether this browser hid the checklist for `site` (false when storage cannot be read). */
export function checklistHidden(site: string): boolean {
  try {
    return globalThis.localStorage?.getItem(hiddenKey(site)) === "1";
  } catch {
    return false;
  }
}

/** Remembers "Hide" in this browser; a storage that refuses it only means the list comes back next time. */
export function hideChecklist(site: string): void {
  try {
    globalThis.localStorage?.setItem(hiddenKey(site), "1");
  } catch {
    // Nothing to do: the list is hidden for this visit anyway.
  }
}

const testKey = (site: string) => `uptellis:test-alert-sent:${site}`;

/**
 * Whether a test alert of `site` went through from this browser (false when storage cannot be read). The
 * server records no test send (`testIncident`), so this is what ticks "Send a test alert".
 */
export function testAlertSent(site: string): boolean {
  try {
    return globalThis.localStorage?.getItem(testKey(site)) === "1";
  } catch {
    return false;
  }
}

/** Remembers a test alert that went through (`testChannel`); a storage that refuses it only forgets it. */
export function rememberTestAlert(site: string): void {
  try {
    globalThis.localStorage?.setItem(testKey(site), "1");
  } catch {
    // The item stays ticked for this visit through the page's own state.
  }
}

const skipKey = (site: string) => `uptellis:welcome-skipped:${site}`;
/** Skips of this page load, so a browser that refuses storage is never sent back to the screen it skipped. */
const skippedHere = new Set<string>();

/** Whether "Skip for now" was chosen on the first-run screen in this browser. */
export function welcomeSkipped(site: string): boolean {
  if (skippedHere.has(site)) return true;
  try {
    return globalThis.localStorage?.getItem(skipKey(site)) === "1";
  } catch {
    return false;
  }
}

export function skipWelcome(site: string): void {
  skippedHere.add(site);
  try {
    globalThis.localStorage?.setItem(skipKey(site), "1");
  } catch {
    // Without storage the first-run screen may come back on a later visit, which is harmless.
  }
}
