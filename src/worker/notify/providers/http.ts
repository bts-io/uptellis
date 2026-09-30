/**
 * The one HTTP send every webhook-style provider shares: a POST under a 5 s timeout, mapped to a
 * `DeliveryOutcome`. A 2xx is a delivery; a 429 or 5xx, a timeout or a network error is retryable (with the
 * service's `Retry-After` or `retry_after` when it gives one); any other status is a final failure. The
 * response body is read only for a rate limit's `retry_after` (and by a provider's `errorOf`, which maps it
 * to a short code) and never returned; nothing here logs, and an error is a short code (`http_404`,
 * `timeout`), never the URL or a message.
 */
import type { DeliveryOutcome } from "@/shared/notify";

export const SEND_TIMEOUT_MS = 5000;

/** A channel whose secret (URL, token, signing key) is not set. */
export const SECRET_MISSING: DeliveryOutcome = {
  ok: false,
  status: 0,
  error: "secret_missing",
  retryable: false,
};

/** A config problem the provider found before sending (`bad_url`, `email_no_from`): final. */
export const refused = (error: string): DeliveryOutcome => ({
  ok: false,
  status: 0,
  error,
  retryable: false,
});

/** An http(s) URL with no credentials in it, or null. */
export function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** A non-negative number of seconds from a JSON `retry_after` or a `Retry-After` header, else undefined. */
function retryAfterOf(res: Response, data: unknown): number | undefined {
  const d = data as { retry_after?: unknown; parameters?: { retry_after?: unknown } } | null;
  const candidates = [d?.retry_after, d?.parameters?.retry_after, res.headers.get("retry-after")];
  for (const c of candidates) {
    if (c === null || c === undefined || c === "") continue;
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

/**
 * `errorOf` names a failure from its status and parsed JSON body (null when not JSON) with a short code of
 * the provider's own, never text from the body; undefined keeps `rate_limited` or `http_<status>`.
 */
export async function postTo(
  doFetch: typeof fetch,
  url: URL | string,
  init: { headers: Record<string, string>; body: string },
  errorOf?: (status: number, data: unknown) => string | undefined,
): Promise<DeliveryOutcome> {
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, status: 0, error: timeout ? "timeout" : "network", retryable: true };
  }
  const text = await res.text().catch(() => "");
  if (res.ok) return { ok: true, status: res.status };
  const retryable = res.status === 429 || res.status >= 500;
  let data: unknown = null;
  if (retryable || errorOf) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  const after = retryable ? retryAfterOf(res, data) : undefined;
  return {
    ok: false,
    status: res.status,
    error: errorOf?.(res.status, data) ?? (res.status === 429 ? "rate_limited" : `http_${res.status}`),
    retryable,
    ...(after === undefined ? {} : { retryAfterS: after }),
  };
}
