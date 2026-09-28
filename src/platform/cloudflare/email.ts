/**
 * The Cloudflare email sender: the Email Service `send_email` binding named `EMAIL` (commented out in
 * wrangler.jsonc until the sending domain is onboarded). Its `send` throws an error with a `code` on a
 * refusal: a rate limit is retryable, a config problem (unverified sender, invalid message) is final.
 * Nothing about the message or the addresses is returned or logged.
 */
import type { DeliveryOutcome, EmailSender } from "@/shared/notify";

/** The binding's shape (`SendEmail` in the Workers types), as far as the sender uses it. */
export interface SendEmailBinding {
  send(message: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

/** Final refusals: the sender or the message is wrong, a retry would fail the same way. */
const FINAL = new Set([
  "E_SENDER_NOT_VERIFIED",
  "E_VALIDATION_ERROR",
  "E_TOO_MANY_RECIPIENTS",
  "E_FIELD_MISSING",
  "E_CONTENT_TOO_LARGE",
]);

/** `E_SENDER_NOT_VERIFIED` as `email_sender_not_verified`; anything unexpected as `email_error`. */
function outcomeOf(err: unknown): DeliveryOutcome {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "E_RATE_LIMIT_EXCEEDED")
    return { ok: false, status: 429, error: "rate_limited", retryable: true };
  if (typeof code === "string" && FINAL.has(code)) {
    return { ok: false, status: 0, error: `email_${code.slice(2).toLowerCase()}`, retryable: false };
  }
  return { ok: false, status: 0, error: "email_error", retryable: true };
}

export function bindingEmailSender(binding: SendEmailBinding): EmailSender {
  return {
    async send(message) {
      try {
        await binding.send({
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        return { ok: true, status: 200 };
      } catch (err) {
        return outcomeOf(err);
      }
    },
  };
}

/** The `EMAIL` binding's sender, or null when the Worker has none. */
export function cloudflareEmailSender(env: object): EmailSender | null {
  const binding = (env as { EMAIL?: SendEmailBinding }).EMAIL;
  return binding && typeof binding.send === "function" ? bindingEmailSender(binding) : null;
}
