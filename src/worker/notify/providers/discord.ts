/**
 * Discord: the Components V2 card (../card.ts) posted through the channel webhook, with `?wait=true`
 * (Discord answers with the message, so a 2xx means it exists) and `with_components=true` (a webhook
 * ignores components without it). A card that would carry an address, an email or a token is not sent.
 */
import type { ChannelProvider } from "@/shared/notify";
import { alertCard, cardIsSafe } from "../card";
import { parseUrl, postTo, refused, SECRET_MISSING } from "./http";

export const discordProvider: ChannelProvider<"discord"> = {
  type: "discord",
  async send(message, channel, ctx) {
    const raw = ctx.secret(channel.secret);
    if (!raw) return SECRET_MISSING;
    const url = parseUrl(raw);
    if (!url) return refused("bad_url");
    url.searchParams.set("wait", "true");
    url.searchParams.set("with_components", "true");
    const card = alertCard(message);
    if (!cardIsSafe(card)) return refused("forbidden_literal");
    return postTo(ctx.fetch, url, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(card),
    });
  },
};
