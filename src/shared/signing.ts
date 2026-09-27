/**
 * The `X-Uptellis-*` request signature (plan section 5), shared by the Worker (verify) and the Bun collector and
 * fact scripts (sign). WebCrypto only, so the same file runs in workerd, Bun and Node.
 *
 * Canonical string (lines joined with `\n`, no trailing newline):
 *
 *     v1
 *     {keyId}
 *     {ts}            unix seconds, decimal
 *     {nonce}         16 random bytes, lower-case hex (32 characters)
 *     {METHOD}        upper case, e.g. POST
 *     {path}          URL pathname only, no query, e.g. /api/ingest/kuma
 *     {sha256hex(body)}
 *
 * Signature: lower-case hex HMAC-SHA256 of the canonical string, keyed with the UTF-8 bytes of the secret.
 */

export const SIGNATURE_VERSION = "v1";

export const INGEST_HEADERS = {
  keyId: "X-Uptellis-Key-Id",
  timestamp: "X-Uptellis-Timestamp",
  nonce: "X-Uptellis-Nonce",
  signature: "X-Uptellis-Signature",
} as const;

/** Largest accepted body; checked before hashing. */
export const MAX_BODY_BYTES = 256 * 1024;
/** Largest accepted `|now - ts|`. */
export const MAX_SKEW_S = 120;

export const KEY_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const NONCE_RE = /^[0-9a-f]{32}$/;
const TS_RE = /^\d{1,12}$/;
const SIG_RE = /^[0-9a-f]{64}$/;

export type SignedHeaders = Record<(typeof INGEST_HEADERS)[keyof typeof INGEST_HEADERS], string>;
export type Body = string | Uint8Array<ArrayBuffer> | ArrayBuffer;
/** A secret as text (its UTF-8 bytes are the HMAC key) or an imported HMAC CryptoKey. */
export type SigningKey = string | CryptoKey;

const enc = new TextEncoder();

const toBytes = (body: Body): Uint8Array<ArrayBuffer> =>
  typeof body === "string"
    ? (enc.encode(body) as Uint8Array<ArrayBuffer>)
    : body instanceof ArrayBuffer
      ? new Uint8Array(body)
      : body;

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  let out = "";
  for (const b of bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(body: Body): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", toBytes(body)));
}

export function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

const asKey = (key: SigningKey) => (typeof key === "string" ? importSigningKey(key) : Promise.resolve(key));

export interface CanonicalParts {
  keyId: string;
  ts: number | string;
  nonce: string;
  method: string;
  path: string;
  bodySha256Hex: string;
}

export function canonicalString(p: CanonicalParts): string {
  return [
    SIGNATURE_VERSION,
    p.keyId,
    String(p.ts),
    p.nonce,
    p.method.toUpperCase(),
    p.path,
    p.bodySha256Hex,
  ].join("\n");
}

/** 16 random bytes as lower-case hex. */
export function randomNonce(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

const toUnixSeconds = (now: Date | number) => Math.floor((now instanceof Date ? now.getTime() : now) / 1000);

/**
 * Headers for one signed request. `now` is a Date or epoch milliseconds; `nonce` defaults to 16 random
 * bytes. `path` is the URL pathname the server sees (e.g. `/api/ingest/kuma`).
 */
export async function signRequest(
  key: SigningKey,
  keyId: string,
  method: string,
  path: string,
  body: Body,
  now: Date | number = Date.now(),
  nonce: string = randomNonce(),
): Promise<SignedHeaders> {
  if (!KEY_ID_RE.test(keyId)) throw new Error("Invalid key id");
  if (!NONCE_RE.test(nonce)) throw new Error("Nonce must be 16 bytes of lower-case hex");
  const ts = toUnixSeconds(now);
  const data = canonicalString({ keyId, ts, nonce, method, path, bodySha256Hex: await sha256Hex(body) });
  const sig = await crypto.subtle.sign("HMAC", await asKey(key), enc.encode(data));
  return {
    [INGEST_HEADERS.keyId]: keyId,
    [INGEST_HEADERS.timestamp]: String(ts),
    [INGEST_HEADERS.nonce]: nonce,
    [INGEST_HEADERS.signature]: toHex(sig),
  } as SignedHeaders;
}

export type VerifyFailure =
  | "missing_headers"
  | "malformed_headers"
  | "skew"
  | "unknown_key"
  | "bad_signature";

export type VerifyResult =
  | { ok: true; keyId: string; ts: number; nonce: string; keyIndex: number }
  | { ok: false; reason: VerifyFailure };

export interface VerifyInput {
  /** Anything with a case-insensitive `get` (a `Headers`). */
  headers: { get(name: string): string | null };
  method: string;
  path: string;
  body: Body;
  /** Candidate keys for a key id (current first, then next); empty or null means unknown. */
  keysFor: (keyId: string) => SigningKey[] | null | Promise<SigningKey[] | null>;
  now?: Date | number;
  maxSkewS?: number;
}

/**
 * Checks the `X-Uptellis-*` headers against the body. Header shape, then the timestamp window, then the key
 * id, then the HMAC (with `crypto.subtle.verify`, constant time) against each candidate key. The body size
 * limit and nonce replay are the caller's job (before and after this, respectively).
 */
export async function verifyRequest(input: VerifyInput): Promise<VerifyResult> {
  const h = (name: string) => input.headers.get(name);
  const keyId = h(INGEST_HEADERS.keyId);
  const tsRaw = h(INGEST_HEADERS.timestamp);
  const nonce = h(INGEST_HEADERS.nonce);
  const sigHex = h(INGEST_HEADERS.signature);
  if (!keyId || !tsRaw || !nonce || !sigHex) return { ok: false, reason: "missing_headers" };
  if (!KEY_ID_RE.test(keyId) || !TS_RE.test(tsRaw) || !NONCE_RE.test(nonce) || !SIG_RE.test(sigHex)) {
    return { ok: false, reason: "malformed_headers" };
  }
  const ts = Number(tsRaw);
  const now = toUnixSeconds(input.now ?? Date.now());
  if (Math.abs(now - ts) > (input.maxSkewS ?? MAX_SKEW_S)) return { ok: false, reason: "skew" };

  const keys = (await input.keysFor(keyId)) ?? [];
  if (keys.length === 0) return { ok: false, reason: "unknown_key" };

  const data = enc.encode(
    canonicalString({
      keyId,
      ts,
      nonce,
      method: input.method,
      path: input.path,
      bodySha256Hex: await sha256Hex(input.body),
    }),
  );
  const sig = fromHex(sigHex);
  for (const [keyIndex, key] of keys.entries()) {
    if (await crypto.subtle.verify("HMAC", await asKey(key), sig, data)) {
      return { ok: true, keyId, ts, nonce, keyIndex };
    }
  }
  return { ok: false, reason: "bad_signature" };
}
