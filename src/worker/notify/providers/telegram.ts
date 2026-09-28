/**
 * Telegram: the Bot API's `sendMessage` to the channel's chat, in HTML parse mode (every text escaped),
 * without a link preview. The bot token is the channel's secret and only ever goes into the request URL
 * (`https://api.telegram.org/bot<token>/sendMessage`), never into a log or an error. A 429 carries
 * `parameters.retry_after`.
 */
import type { AlertMessage, ChannelProvider } from "@/shared/notify";
import { descriptionOf, EMOJI, factsOf, footerOf, headline } from "../format";
import { postTo, refused, SECRET_MISSING } from "./http";

export const TELEGRAM_API = "https://api.telegram.org";

/** What Telegram's HTML mode needs escaped (text and attribute values). */
export const htmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A bot token: `<bot id>:<secret>`. */
const TOKEN = /^\d{1,20}:[A-Za-z0-9_-]{20,100}$/;

export function telegramText(m: AlertMessage): string {
  return [
    `<b>${htmlEscape(`${EMOJI[m.event]} ${headline(m)}`)}</b>`,
    htmlEscape(descriptionOf(m)),
    "",
    ...factsOf(m).map(([k, v]) => `<b>${htmlEscape(k)}:</b> ${htmlEscape(v)}`),
    "",
    ...(m.pageUrl ? [`<a href="${htmlEscape(m.pageUrl)}">Status page</a>`] : []),
    `<i>${htmlEscape(footerOf(m))}</i>`,
  ].join("\n");
}

export const telegramProvider: ChannelProvider<"telegram"> = {
  type: "telegram",
  async send(message, channel, ctx) {
    const token = ctx.secret(channel.secret);
    if (!token) return SECRET_MISSING;
    if (!TOKEN.test(token)) return refused("bad_token");
    return postTo(ctx.fetch, `${TELEGRAM_API}/bot${token}/sendMessage`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: channel.chatId,
        text: telegramText(message),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  },
};
