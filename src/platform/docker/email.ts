/**
 * The Docker email sender, chosen at startup from the environment (each value may come from `NAME_FILE`):
 *
 * 1. `CLOUDFLARE_EMAIL_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare Email Service REST API
 *    (`POST /accounts/<id>/email/sending/send`, a Bearer token with Email Sending permission);
 * 2. else `SMTP_URL` (`smtps://user:pass@host:465` or `smtp://user:pass@host:587`): SMTP (./smtp.ts);
 * 3. else none: email channels fail with `email_unavailable`.
 *
 * Outcomes follow the providers' rules: 2xx sent, 429 and 5xx retryable, other refusals final. Neither the
 * token, the addresses nor a response body is ever returned or logged.
 */
import type { EmailSender } from "@/shared/notify";
import { postTo, refused } from "@/worker/notify/providers/http";
import { type EnvSource, readEnv } from "./env";
import { parseSmtpUrl, smtpEmailSender } from "./smtp";

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

/** The Email Service REST API sender for one account. */
export function restEmailSender(opts: {
  token: string;
  accountId: string;
  fetch?: typeof fetch;
  base?: string;
}): EmailSender {
  const url = `${opts.base ?? CLOUDFLARE_API}/accounts/${encodeURIComponent(opts.accountId)}/email/sending/send`;
  return {
    send: (message) =>
      postTo(opts.fetch ?? (((input, init) => fetch(input, init)) as typeof fetch), url, {
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.token}` },
        body: JSON.stringify({
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      }),
  };
}

/** A sender that refuses every message with `error` (a configured sender that cannot work). */
const refusing = (error: string): EmailSender => ({ send: async () => refused(error) });

/** The instance's sender from the environment, or null when none is configured. */
export function dockerEmailSender(env: EnvSource): EmailSender | null {
  const token = readEnv(env, "CLOUDFLARE_EMAIL_API_TOKEN");
  const accountId = readEnv(env, "CLOUDFLARE_ACCOUNT_ID");
  if (token && accountId) return restEmailSender({ token, accountId });
  const smtp = readEnv(env, "SMTP_URL");
  if (!smtp) return null;
  const config = parseSmtpUrl(smtp);
  return config ? smtpEmailSender(config) : refusing("smtp_bad_url");
}
