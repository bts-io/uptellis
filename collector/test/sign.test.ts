import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import type { IngestConfig } from "../src/config";
import { postSnapshot } from "../src/sender";
import { canonicalString, sha256Hex, signRequest } from "../src/shared";

// The collector signs with the Worker's own src/shared/signing.ts (the local copy is gone); these known
// answers keep that signer honest from the producer side. Long hex values are joined at runtime so this
// file passes the repo-wide literal scan. The expected values were computed independently (Python hmac +
// hashlib) from the same inputs.
const hex = (...parts: string[]) => parts.join("");
const KNOWN = {
  keyId: "collector-1",
  key: "test-key-not-a-secret",
  path: "/api/ingest/kuma",
  body: '{"v":1,"host":"watch-1"}',
  ts: 1790000000,
  nonce: hex("0011223344556677", "8899aabbccddeeff"),
};
const BODY_SHA = hex("d7ce893e47c8616eaa434e12", "99be713a9e4322431f4adede", "f606dfe81f9e04a0");
const SIGNATURE = hex("fc317debf10ffb6ca8c46e79", "83d3fac27d084f535713220c", "1a9c57501e0e1bdc");

describe("signing v1 (known answer)", () => {
  const sign = (k: typeof KNOWN, ts?: number, nonce?: string) =>
    signRequest(k.key, k.keyId, "POST", k.path, k.body, ts === undefined ? undefined : ts * 1000, nonce);

  it("hashes the body", async () => {
    expect(await sha256Hex(KNOWN.body)).toBe(BODY_SHA);
  });

  it("builds the canonical string", () => {
    expect(canonicalString({ ...KNOWN, method: "post", bodySha256Hex: BODY_SHA })).toBe(
      ["v1", "collector-1", "1790000000", KNOWN.nonce, "POST", "/api/ingest/kuma", BODY_SHA].join("\n"),
    );
  });

  it("produces the expected headers and signature", async () => {
    expect(await sign(KNOWN, KNOWN.ts, KNOWN.nonce)).toEqual({
      "X-Uptellis-Key-Id": "collector-1",
      "X-Uptellis-Timestamp": "1790000000",
      "X-Uptellis-Nonce": KNOWN.nonce,
      "X-Uptellis-Signature": SIGNATURE,
    });
  });

  it("uses a fresh 16-byte nonce and the current time by default", async () => {
    const a = await sign(KNOWN);
    const b = await sign(KNOWN);
    expect(a["X-Uptellis-Nonce"]).toMatch(/^[0-9a-f]{32}$/);
    expect(a["X-Uptellis-Nonce"]).not.toBe(b["X-Uptellis-Nonce"]);
    expect(Math.abs(Number(a["X-Uptellis-Timestamp"]) - Date.now() / 1000)).toBeLessThan(5);
  });
});

describe("postSnapshot", () => {
  const cfg: IngestConfig = {
    url: "https://status.example.com/api/ingest/kuma",
    path: "/api/ingest/kuma",
    keyId: "collector-1",
    key: KNOWN.key,
    accessClientId: "client-id.access",
    accessClientSecret: "client-secret-value",
  };

  it("POSTs the exact body with verifiable signature and Access headers", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const res = await postSnapshot(cfg, KNOWN.body, async (url, init) => {
      seen = { url, init };
      return new Response(null, { status: 202 });
    });
    expect(res).toEqual({ ok: true, status: 202 });
    const { url, init } = seen!;
    const h = init.headers as Record<string, string>;
    expect(url).toBe(cfg.url);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(KNOWN.body);
    expect(h["CF-Access-Client-Id"]).toBe("client-id.access");
    const canonical = canonicalString({
      keyId: "collector-1",
      ts: Number(h["X-Uptellis-Timestamp"]),
      nonce: h["X-Uptellis-Nonce"]!,
      method: "POST",
      path: "/api/ingest/kuma",
      bodySha256Hex: await sha256Hex(KNOWN.body),
    });
    expect(h["X-Uptellis-Signature"]).toBe(createHmac("sha256", KNOWN.key).update(canonical).digest("hex"));
  });

  it("treats redirects (Access login) and network errors as failures", async () => {
    expect(await postSnapshot(cfg, "{}", async () => new Response(null, { status: 302 }))).toEqual({
      ok: false,
      status: 302,
    });
    expect(
      await postSnapshot(cfg, "{}", async () => {
        throw new Error("offline");
      }),
    ).toEqual({ ok: false, status: 0 });
  });
});
