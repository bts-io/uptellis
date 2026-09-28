/**
 * Phase 6b contract (lead): what a channel provider is. One provider per `ChannelType`, in
 * src/worker/notify/providers/ (the `channels` stream). A provider formats an `AlertMessage` for its
 * service and sends it; it never throws, never logs a secret, URL, token or response body, and reports a
 * short error code. The dispatcher (dedup, retries, the delivery log) sits above it.
 */
import type { AlertMessage } from "./message";
import type { ChannelConfig, ChannelSecretName } from "./schema";

export type DeliveryOutcome =
  | { ok: true; status: number }
  /** `retryable`: a 429, 5xx or network error; false for a bad config (401, 403, 404, bad URL, missing secret). */
  | { ok: false; status: number; error: string; retryable: boolean; retryAfterS?: number };

/** A plain email; the instance's sender adds nothing but its own envelope. */
export interface OutgoingEmail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

/**
 * The instance's email sender: the Cloudflare Email Service `send_email` binding on Cloudflare; in Docker the
 * Email Service REST API (`CLOUDFLARE_EMAIL_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`) or SMTP (`SMTP_URL`).
 * Absent when none is configured: email channels then fail with `email_unavailable`.
 */
export interface EmailSender {
  send(message: OutgoingEmail): Promise<DeliveryOutcome>;
}

export interface ProviderContext {
  /** `Platform.notifySecret`: undefined when unset. */
  secret(name: ChannelSecretName): string | undefined;
  email: EmailSender | null;
  /** The `EMAIL_FROM` setting (the default sender address). */
  emailFrom: string | undefined;
  fetch: typeof fetch;
  /** For the webhook signature and the user agent. */
  version: string;
  now(): number;
}

export interface ChannelProvider<T extends ChannelConfig["type"] = ChannelConfig["type"]> {
  type: T;
  send(
    message: AlertMessage,
    channel: Extract<ChannelConfig, { type: T }>,
    ctx: ProviderContext,
  ): Promise<DeliveryOutcome>;
}
