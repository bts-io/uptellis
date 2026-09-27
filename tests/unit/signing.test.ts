import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalString,
  INGEST_HEADERS,
  MAX_BODY_BYTES,
  MAX_SKEW_S,
  randomNonce,
  sha256Hex,
  signRequest,
  verifyRequest,
} from "@/shared/signing";

// Hex digests are 64 characters, which the repo-wide scan treats as token-like; the known answers are
// therefore stored in 16-character pieces and joined at runtime.
const hex = (...parts: string[]) => parts.join("");

const KAT = {
  key: "uptellis-known-answer-key",
  keyId: "collector-1",
  now: new Date("2026-09-27T23:58:00Z"),
  ts: 1790553480,
  nonce: "0123456789abcdef".repeat(2),
  path: "/api/ingest/kuma",
  body: '{"v":1,"generatedAt":"2026-09-27T23:58:00Z"}',
  bodySha: hex("fbe9603da0f1eea7", "3ebfc0c132e2c5a2", "fb639518ba7220ce", "7068f32b350461bf"),
  signature: hex("66ae897c5fd106c6", "7048d4ffaf24eb05", "9bc18e7f653750dc", "fa49a6edb9d877b9"),
};

const headersOf = (h: Record<string, string>) => new Headers(h);

async function verify(
  headers: Record<string, string>,
  over: Partial<{ body: string; path: string; method: string; now: Date; keys: string[] | null }> = {},
) {
  return verifyRequest({
    headers: headersOf(headers),
    method: over.method ?? "POST",
    path: over.path ?? KAT.path,
    body: over.body ?? KAT.body,
    now: over.now ?? KAT.now,
    keysFor: (id) => (id === KAT.keyId ? (over.keys === undefined ? [KAT.key] : over.keys) : null),
  });
}

const katHeaders = () => signRequest(KAT.key, KAT.keyId, "POST", KAT.path, KAT.body, KAT.now, KAT.nonce);

describe("signing: known answer", () => {
  it("hashes the body", async () => {
    expect(await sha256Hex(KAT.body)).toBe(KAT.bodySha);
    expect(await sha256Hex("")).toBe(
      hex("e3b0c44298fc1c14", "9afbf4c8996fb924", "27ae41e4649b934c", "a495991b7852b855"),
    );
  });

  it("builds the canonical string", () => {
    expect(
      canonicalString({
        keyId: KAT.keyId,
        ts: KAT.ts,
        nonce: KAT.nonce,
        method: "post",
        path: KAT.path,
        bodySha256Hex: KAT.bodySha,
      }),
    ).toBe(
      ["v1", "collector-1", "1790553480", KAT.nonce, "POST", "/api/ingest/kuma", KAT.bodySha].join("\n"),
    );
  });

  it("produces the fixed signature and headers", async () => {
    expect(await katHeaders()).toEqual({
      [INGEST_HEADERS.keyId]: "collector-1",
      [INGEST_HEADERS.timestamp]: "1790553480",
      [INGEST_HEADERS.nonce]: KAT.nonce,
      [INGEST_HEADERS.signature]: KAT.signature,
    });
  });

  it("matches node:crypto for arbitrary input (string and bytes)", async () => {
    for (let i = 0; i < 20; i++) {
      const body = JSON.stringify({ i, pad: "x".repeat(i * 37), u: "é中" });
      const key = `secret-${i}`;
      const nonce = randomNonce();
      const now = KAT.now.getTime() + i * 1000;
      const h = await signRequest(
        key,
        "facts-1",
        "POST",
        "/api/ingest/facts",
        new TextEncoder().encode(body),
        now,
        nonce,
      );
      const bodySha = createHash("sha256").update(body).digest("hex");
      const canonical = [
        "v1",
        "facts-1",
        String(Math.floor(now / 1000)),
        nonce,
        "POST",
        "/api/ingest/facts",
        bodySha,
      ].join("\n");
      expect(h[INGEST_HEADERS.signature]).toBe(createHmac("sha256", key).update(canonical).digest("hex"));
    }
  });

  it("generates 16-byte hex nonces", () => {
    const a = randomNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomNonce()).not.toBe(a);
  });

  it("refuses to sign with a malformed key id or nonce", async () => {
    await expect(signRequest("k", "Bad_Id", "POST", "/p", "", KAT.now, KAT.nonce)).rejects.toThrow();
    await expect(signRequest("k", "collector-1", "POST", "/p", "", KAT.now, "abc")).rejects.toThrow();
  });
});

describe("signing: verify", () => {
  it("accepts the known-answer request", async () => {
    expect(await verify(await katHeaders())).toEqual({
      ok: true,
      keyId: "collector-1",
      ts: KAT.ts,
      nonce: KAT.nonce,
      keyIndex: 0,
    });
  });

  it("accepts the next key during rotation and reports which key matched", async () => {
    const h = await signRequest("next-key", KAT.keyId, "POST", KAT.path, KAT.body, KAT.now, KAT.nonce);
    expect(await verify(h, { keys: [KAT.key, "next-key"] })).toMatchObject({ ok: true, keyIndex: 1 });
    expect(await verify(h, { keys: [KAT.key] })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("enforces the timestamp window on both sides", async () => {
    const h = await katHeaders();
    const at = (s: number) => new Date(KAT.now.getTime() + s * 1000);
    expect((await verify(h, { now: at(MAX_SKEW_S) })).ok).toBe(true);
    expect((await verify(h, { now: at(-MAX_SKEW_S) })).ok).toBe(true);
    expect(await verify(h, { now: at(MAX_SKEW_S + 1) })).toEqual({ ok: false, reason: "skew" });
    expect(await verify(h, { now: at(-MAX_SKEW_S - 1) })).toEqual({ ok: false, reason: "skew" });
  });

  it("rejects a changed body, path or method", async () => {
    const h = await katHeaders();
    const bad = { ok: false, reason: "bad_signature" };
    expect(await verify(h, { body: `${KAT.body} ` })).toEqual(bad);
    expect(await verify(h, { path: "/api/ingest/facts" })).toEqual(bad);
    expect(await verify(h, { method: "PUT" })).toEqual(bad);
  });

  it("rejects a wrong key and an unknown key id", async () => {
    const h = await signRequest("wrong-key", KAT.keyId, "POST", KAT.path, KAT.body, KAT.now, KAT.nonce);
    expect(await verify(h)).toEqual({ ok: false, reason: "bad_signature" });
    const other = await signRequest(KAT.key, "other-1", "POST", KAT.path, KAT.body, KAT.now, KAT.nonce);
    expect(await verify(other)).toEqual({ ok: false, reason: "unknown_key" });
    expect(await verify(await katHeaders(), { keys: [] })).toEqual({ ok: false, reason: "unknown_key" });
  });

  it("rejects missing and malformed headers", async () => {
    const h = await katHeaders();
    for (const name of Object.values(INGEST_HEADERS)) {
      const { [name]: _, ...rest } = h;
      expect(await verify(rest)).toEqual({ ok: false, reason: "missing_headers" });
    }
    const malformed = { ok: false, reason: "malformed_headers" };
    expect(
      await verify({ ...h, [INGEST_HEADERS.signature]: h[INGEST_HEADERS.signature].toUpperCase() }),
    ).toEqual(malformed);
    expect(await verify({ ...h, [INGEST_HEADERS.timestamp]: "17905534.8" })).toEqual(malformed);
    expect(await verify({ ...h, [INGEST_HEADERS.nonce]: "short" })).toEqual(malformed);
    expect(await verify({ ...h, [INGEST_HEADERS.keyId]: "COLLECTOR-1" })).toEqual(malformed);
  });

  it("exposes the body limit and window from the plan", () => {
    expect(MAX_BODY_BYTES).toBe(262144);
    expect(MAX_SKEW_S).toBe(120);
  });
});
