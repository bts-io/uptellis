/** Random tokens and their stored form: only a SHA-256 of a token is ever written to the database. */
import { toBase64Url } from "../engine/seal";

const enc = new TextEncoder();

/** 32 random bytes, base64url (43 characters). */
export const randomToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

/** A short random id: `length` characters of lower-case letters and digits. */
export function randomId(length = 12): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  // 252 is the largest multiple of 36 below 256: rejecting bytes above it keeps the choice uniform.
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length))) {
      if (b < 252 && out.length < length) out += alphabet[b % 36];
    }
  }
  return out;
}

/** Hex SHA-256 of `token`. */
export async function hashToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(token)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Equality that takes the same time wherever the inputs differ: both sides are hashed, then XOR-compared. */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}
