/**
 * Slack: an incoming webhook message in Block Kit. The blocks sit in one attachment so the event's colour
 * shows as its side bar: a header (`🔴 Uptellis: Checkout is down`, TEST first on a test), what it means,
 * the facts as fields, a Status page button and a context line. `text` is the notification fallback.
 * Slack answers 200 `ok`; a 429 carries `Retry-After`.
 */
import type { AlertMessage, ChannelProvider, NotifyEvent } from "@/shared/notify";
import { descriptionOf, EMOJI, factsOf, footerOf, headline } from "../format";
import { parseUrl, postTo, refused, SECRET_MISSING } from "./http";

/** The side bar colours (the Discord accents). */
export const SLACK_COLOR: Record<NotifyEvent, string> = {
  down: "#dc2626",
  stale: "#7f1d1d",
  up: "#22c55e",
  recovered: "#22c55e",
};

/** Slack's mrkdwn escaping: only `&`, `<` and `>` are control characters. */
export const slackEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function slackPayload(m: AlertMessage) {
  const title = `${EMOJI[m.event]} ${headline(m)}`;
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: clip(title, 150), emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: slackEscape(descriptionOf(m)) } },
    {
      type: "section",
      fields: factsOf(m)
        .slice(0, 10)
        .map(([k, v]) => ({ type: "mrkdwn", text: clip(`*${slackEscape(k)}*\n${slackEscape(v)}`, 2000) })),
    },
  ];
  if (m.pageUrl) {
    blocks.push({
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "Status page" }, url: m.pageUrl }],
    });
  }
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: slackEscape(footerOf(m)) }] });
  return { text: slackEscape(title), attachments: [{ color: SLACK_COLOR[m.event], blocks }] };
}

export const slackProvider: ChannelProvider<"slack"> = {
  type: "slack",
  async send(message, channel, ctx) {
    const raw = ctx.secret(channel.secret);
    if (!raw) return SECRET_MISSING;
    const url = parseUrl(raw);
    if (!url) return refused("bad_url");
    return postTo(ctx.fetch, url, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(slackPayload(message)),
    });
  },
};
