/**
 * Email: sent by the instance's sender (`ProviderContext.email`: the Email Service binding on Cloudflare,
 * the Email Service REST API or SMTP in Docker) to the channel's addresses, from the channel's `from` or
 * the `EMAIL_FROM` setting. Subject `[Uptellis] Checkout is down` (`[Uptellis] TEST: ...` on a test), a
 * plain text part and a small inline-styled HTML part. Without a sender the channel fails with
 * `email_unavailable`, without a from address with `email_no_from`; both are final.
 */
import type { AlertMessage, ChannelProvider, NotifyEvent } from "@/shared/notify";
import { descriptionOf, EMOJI, factsOf, footerOf, headline, textSummary } from "../format";
import { refused } from "./http";
import { htmlEscape } from "./telegram";

const COLOR: Record<NotifyEvent, string> = {
  down: "#dc2626",
  stale: "#7f1d1d",
  up: "#22c55e",
  recovered: "#22c55e",
};

export const emailSubject = (m: AlertMessage) => `[Uptellis] ${m.test ? "TEST: " : ""}${m.title}`;

export function emailHtml(m: AlertMessage): string {
  const rows = factsOf(m)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;white-space:nowrap">${htmlEscape(k)}</td>` +
        `<td style="padding:2px 0">${htmlEscape(v)}</td></tr>`,
    )
    .join("");
  const button = m.pageUrl
    ? `<p style="margin:16px 0 0"><a href="${htmlEscape(m.pageUrl)}" style="color:#2563eb">Status page</a></p>`
    : "";
  return (
    `<!doctype html><html><body style="margin:0;padding:16px;font-family:system-ui,sans-serif;color:#111827">` +
    `<div style="max-width:560px;border-left:4px solid ${COLOR[m.event]};padding:4px 16px">` +
    `<h2 style="margin:0 0 8px;font-size:18px">${htmlEscape(`${EMOJI[m.event]} ${headline(m)}`)}</h2>` +
    `<p style="margin:0 0 12px">${htmlEscape(descriptionOf(m))}</p>` +
    `<table style="border-collapse:collapse;font-size:14px">${rows}</table>${button}` +
    `<p style="margin:16px 0 0;font-size:12px;color:#6b7280">${htmlEscape(footerOf(m))}</p>` +
    `</div></body></html>`
  );
}

export const emailProvider: ChannelProvider<"email"> = {
  type: "email",
  async send(message, channel, ctx) {
    if (!ctx.email) return refused("email_unavailable");
    const from = channel.from ?? ctx.emailFrom;
    if (!from) return refused("email_no_from");
    try {
      return await ctx.email.send({
        from,
        to: [...channel.to],
        subject: emailSubject(message),
        text: textSummary(message),
        html: emailHtml(message),
      });
    } catch {
      return { ok: false, status: 0, error: "email_error", retryable: true };
    }
  },
};
