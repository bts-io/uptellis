/**
 * Phase 6b contract (lead): the signed webhook. The body is the `AlertMessage` as JSON (UTF-8). Headers:
 *
 * - `Content-Type: application/json`
 * - `User-Agent: uptellis/<version>`
 * - `X-Uptellis-Event: <event>` (`down`, `up`, `stale`, `recovered`)
 * - `X-Uptellis-Delivery: <id>`: unique per delivery attempt series; retries of one delivery reuse it
 * - `X-Uptellis-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>` over `<t>.<body>` with the channel's
 *   signing secret as the key (the Stripe scheme, so existing verifiers are easy to adapt)
 *
 * A receiver recomputes the HMAC over `t + "." + rawBody`, compares in constant time and rejects a `t`
 * more than `WEBHOOK_TOLERANCE_S` away from its clock (replay). A 2xx answer is a delivery; anything else
 * is retried with backoff.
 */
export const SIGNATURE_HEADER = "X-Uptellis-Signature";
export const EVENT_HEADER = "X-Uptellis-Event";
export const DELIVERY_HEADER = "X-Uptellis-Delivery";
export const WEBHOOK_TOLERANCE_S = 300;

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** The `X-Uptellis-Signature` value for `body` at `tS` (unix seconds). */
export async function signWebhook(secret: string, body: string, tS: number): Promise<string> {
  return `t=${tS},v1=${await hmac(secret, `${tS}.${body}`)}`;
}

/** Verifies a signature header against the raw body at `nowS`; false on any mismatch or a stale `t`. */
export async function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  nowS: number,
): Promise<boolean> {
  const parts = new Map(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
    }),
  );
  const t = Number(parts.get("t"));
  const v1 = parts.get("v1") ?? "";
  if (!Number.isInteger(t) || Math.abs(nowS - t) > WEBHOOK_TOLERANCE_S || !/^[0-9a-f]{64}$/.test(v1))
    return false;
  const expected = await hmac(secret, `${t}.${body}`);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
