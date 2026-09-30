/**
 * The webhook (src/shared/notify/webhook.ts): the `AlertMessage` as JSON, with the event and a delivery
 * id; with a signing secret also an HMAC-SHA256 signature over `<t>.<body>` keyed with it, without one a
 * plain, unsigned POST. An auth secret's value goes out as the `Authorization` header as is (`Bearer ...`,
 * `Basic ...`) and nowhere else: a value that could split the header is refused without a request.
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

/** Whether `value` can be sent as a header value as is: printable ASCII and tabs, so never a CR or LF. */
export const headerValue = (value: string) => /^[\t\x20-\x7e]+$/.test(value);

export const webhookProvider: ChannelProvider<"webhook"> = {
  type: "webhook",
  async send(message, channel, ctx) {
    const raw = ctx.secret(channel.secret);
    if (!raw) return SECRET_MISSING;
    const key = channel.signingSecret ? ctx.secret(channel.signingSecret) : undefined;
    if (channel.signingSecret && !key) return SECRET_MISSING;
    const auth = channel.authSecret ? ctx.secret(channel.authSecret) : undefined;
    if (channel.authSecret && !auth) return SECRET_MISSING;
    if (auth !== undefined && !headerValue(auth)) return refused("bad_auth_header");
    const url = parseUrl(raw);
    if (!url) return refused("bad_url");
    const body = JSON.stringify(message);
    const signature = key ? await signWebhook(key, body, Math.floor(ctx.now() / 1000)) : undefined;
    return postTo(ctx.fetch, url, {
      headers: {
        "content-type": "application/json",
        "user-agent": `uptellis/${ctx.version}`,
        [EVENT_HEADER]: message.event,
        [DELIVERY_HEADER]: await deliveryId(message, channel.id),
        ...(signature ? { [SIGNATURE_HEADER]: signature } : {}),
        ...(auth ? { Authorization: auth } : {}),
      },
      body,
    });
  },
};
