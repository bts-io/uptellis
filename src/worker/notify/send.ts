/**
 * Posts a card through the Discord channel webhook: `?wait=true` (Discord answers with the message, so a
 * 2xx means it exists) and `with_components=true` (a webhook ignores components without it). Each attempt
 * times out after 5 s; a 429 is retried once after Discord's `retry_after`, anything else is final. Never
 * throws: the outcome carries a short error code, never the URL, the response body or a message.
 */
import type { DiscordCard } from "./card";

export const SEND_TIMEOUT_MS = 5000;
/** A longer `retry_after` than this is not waited for: the cron and the ingest have work to finish. */
export const MAX_RETRY_AFTER_S = 30;

export type SendOutcome = { ok: true; status: number } | { ok: false; status: number; error: string };

export interface SendOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function postCard(
  webhookUrl: string,
  card: DiscordCard,
  opts: SendOptions = {},
): Promise<SendOutcome> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? wait;
  let url: URL;
  try {
    url = new URL(webhookUrl);
  } catch {
    return { ok: false, status: 0, error: "bad_webhook_url" };
  }
  url.searchParams.set("wait", "true");
  url.searchParams.set("with_components", "true");
  const body = JSON.stringify(card);

  const attempt = async (): Promise<{ outcome: SendOutcome; retryAfterS?: number }> => {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (err) {
      const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return { outcome: { ok: false, status: 0, error: timeout ? "timeout" : "network" } };
    }
    const data = (await res.json().catch(() => null)) as { retry_after?: unknown } | null;
    if (res.ok) return { outcome: { ok: true, status: res.status } };
    if (res.status === 429) {
      const after =
        typeof data?.retry_after === "number" ? data.retry_after : Number(res.headers.get("retry-after"));
      return {
        outcome: { ok: false, status: 429, error: "rate_limited" },
        retryAfterS: Number.isFinite(after) && after >= 0 ? after : 1,
      };
    }
    return { outcome: { ok: false, status: res.status, error: `http_${res.status}` } };
  };

  const first = await attempt();
  if (first.retryAfterS === undefined || first.retryAfterS > MAX_RETRY_AFTER_S) return first.outcome;
  await sleep(Math.ceil(first.retryAfterS * 1000));
  return (await attempt()).outcome;
}
