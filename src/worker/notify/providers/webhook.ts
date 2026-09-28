/**
 * The signed webhook (src/shared/notify/webhook.ts): the `AlertMessage` as JSON, with the event, a
 * delivery id and an HMAC-SHA256 signature over `<t>.<body>` keyed with the channel's signing secret.
 * The delivery id is derived from (site, incident, event, channel), so every retry of one delivery (in the
 * request or by the five-minute job) carries the same id and a receiver can drop duplicates; a test
 * message adds its build time, so each test is a delivery of its own.
 */
import {
  type AlertMessage,
  type ChannelProvider,
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  signWebhook,
} from "@/shared/notify";
import { parseUrl, postTo, refused, SECRET_MISSING } from "./http";

/** 32 hex characters of SHA-256 over the delivery's identity. */
export async function deliveryId(message: AlertMessage, channelId: string): Promise<string> {
  const parts = [message.site.slug, message.incidentId, message.event, channelId];
  if (message.test) parts.push(message.sentAt);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\n")));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const webhookProvider: ChannelProvider<"webhook"> = {
  type: "webhook",
  async send(message, channel, ctx) {
    const raw = ctx.secret(channel.secret);
    const key = ctx.secret(channel.signingSecret);
    if (!raw || !key) return SECRET_MISSING;
    const url = parseUrl(raw);
    if (!url) return refused("bad_url");
    const body = JSON.stringify(message);
    const signature = await signWebhook(key, body, Math.floor(ctx.now() / 1000));
    return postTo(ctx.fetch, url, {
      headers: {
        "content-type": "application/json",
        "user-agent": `uptellis/${ctx.version}`,
        [EVENT_HEADER]: message.event,
        [DELIVERY_HEADER]: await deliveryId(message, channel.id),
        [SIGNATURE_HEADER]: signature,
      },
      body,
    });
  },
};
