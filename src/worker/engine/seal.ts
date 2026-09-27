/**
 * Sealing for secrets at rest (ingest keys in D1). The Worker secret `SOURCE_MASTER_KEY` (32 random bytes,
 * base64) is the HKDF-SHA256 input; the derived AES-256-GCM key seals each secret with a fresh 12-byte IV
 * and the key id as additional data, so a sealed value only opens for the row it was written for.
 *
 * Sealed form: `v1.<base64url IV>.<base64url ciphertext and tag>`. Errors never carry the plaintext.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

const HKDF_SALT = enc.encode("uptellis/seal");
const HKDF_INFO = enc.encode("ingest-key v1");

export class MasterKeyMissing extends Error {
  constructor() {
    super("SOURCE_MASTER_KEY is not set (32 random bytes, base64)");
    this.name = "MasterKeyMissing";
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A fresh random secret for an ingest key: 32 bytes, base64url (43 characters). */
export const randomSecret = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

/** The AES-GCM key derived from the master key; throws `MasterKeyMissing` when it is unset or malformed. */
export async function sealingKey(master: string | undefined): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = fromBase64((master ?? "").trim());
  } catch {
    throw new MasterKeyMissing();
  }
  if (raw.length !== 32) throw new MasterKeyMissing();
  const ikm = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(key: CryptoKey, plaintext: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(context) },
    key,
    enc.encode(plaintext),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ct))}`;
}

/** The plaintext of a sealed value; throws (without detail) on a wrong key, context or tampering. */
export async function unseal(key: CryptoKey, sealed: string, context: string): Promise<string> {
  const m = /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)$/.exec(sealed);
  if (!m) throw new Error("Malformed sealed value");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(m[1]!), additionalData: enc.encode(context) },
    key,
    fromBase64(m[2]!),
  );
  return dec.decode(pt);
}
