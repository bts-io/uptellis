/**
 * ntfy: a POST of the plain text summary to the topic URL (`https://ntfy.sh/<topic>` or a self-hosted
 * server), with the heading as `Title`, a `Priority` per event (down 5, stale 4, up and recovered 3),
 * emoji `Tags` (plus `test` on a test), `Click` to the status page, and `Authorization: Bearer` when the
 * channel names a token secret. Header values are ASCII: a non-ASCII title goes RFC 2047 encoded, which
 * ntfy decodes.
 */
import type { AlertMessage, ChannelProvider, NotifyEvent } from "@/shared/notify";
import { headline, textSummary } from "../format";
import { parseUrl, postTo, refused, SECRET_MISSING } from "./http";

export const NTFY_PRIORITY: Record<NotifyEvent, number> = { down: 5, stale: 4, up: 3, recovered: 3 };
export const NTFY_TAGS: Record<NotifyEvent, string> = {
  down: "red_circle",
  stale: "rotating_light",
  up: "white_check_mark",
  recovered: "white_check_mark",
};

/** The value as is when it is printable ASCII, else `=?UTF-8?B?<base64>?=`. */
export function headerSafe(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

export function ntfyHeaders(m: AlertMessage, token: string | undefined): Record<string, string> {
  return {
    "content-type": "text/plain; charset=utf-8",
    Title: headerSafe(headline(m)),
    Priority: String(NTFY_PRIORITY[m.event]),
    Tags: m.test ? `${NTFY_TAGS[m.event]},test` : NTFY_TAGS[m.event],
    ...(m.pageUrl ? { Click: m.pageUrl } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export const ntfyProvider: ChannelProvider<"ntfy"> = {
  type: "ntfy",
  async send(message, channel, ctx) {
    const raw = ctx.secret(channel.secret);
    if (!raw) return SECRET_MISSING;
    const token = channel.tokenSecret ? ctx.secret(channel.tokenSecret) : undefined;
    if (channel.tokenSecret && !token) return SECRET_MISSING;
    const url = parseUrl(raw);
    if (!url) return refused("bad_url");
    return postTo(ctx.fetch, url, {
      headers: ntfyHeaders(message, token),
      body: textSummary(message, { heading: false }),
    });
  },
};
