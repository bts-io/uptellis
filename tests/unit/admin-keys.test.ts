import { describe, expect, it } from "vitest";
import {
  MasterKeyMissing,
  randomSecret,
  seal,
  sealingKey,
  toBase64Url,
  unseal,
} from "../../src/worker/engine/seal";
import { envSecrets, INGEST_KEY_BINDINGS, resolveKey, type StoredKeys } from "../../src/worker/ingest/keys";

const master = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

describe("sealing", () => {
  it("round-trips under the same master key and key id, with a fresh IV each time", async () => {
    const key = await sealingKey(master());
    const secret = randomSecret();
    const a = await seal(key, secret, "collector-1");
    const b = await seal(key, secret, "collector-1");
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain(secret);
    expect(await unseal(key, a, "collector-1")).toBe(secret);
    expect(await unseal(key, b, "collector-1")).toBe(secret);
  });

  it("does not open for another key id, another master key or a tampered value", async () => {
    const key = await sealingKey(master());
    const sealed = await seal(key, "payload", "collector-1");
    await expect(unseal(key, sealed, "facts-1")).rejects.toThrow();
    await expect(unseal(await sealingKey(master()), sealed, "collector-1")).rejects.toThrow();
    // Tamper with the first ciphertext character: all 6 of its bits are data. (The last character can carry
    // padding bits, so changing it may decode to the same bytes and legitimately open.)
    const cut = sealed.lastIndexOf(".") + 1;
    const first = sealed[cut] === "A" ? "B" : "A";
    await expect(
      unseal(key, `${sealed.slice(0, cut)}${first}${sealed.slice(cut + 1)}`, "collector-1"),
    ).rejects.toThrow();
    await expect(unseal(key, "v2.x.y", "collector-1")).rejects.toThrow();
  });

  it("needs a 32-byte base64 master key (trailing newline allowed)", async () => {
    for (const bad of [undefined, "", "short", btoa("x".repeat(31)), "not base64 !!"]) {
      await expect(sealingKey(bad)).rejects.toBeInstanceOf(MasterKeyMissing);
    }
    await expect(sealingKey(`${master()}\n`)).resolves.toBeDefined();
  });

  it("issues 32-byte base64url secrets", () => {
    const s = randomSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s).not.toBe(randomSecret());
    expect(toBase64Url(new Uint8Array([251, 255]))).toBe("-_8");
  });
});

describe("resolveKey", () => {
  const env = { INGEST_KEY_COLLECTOR_1: "env-current\n", INGEST_KEY_COLLECTOR_1_NEXT: "env-next" };

  it("uses the env binding and secrets when D1 has no row", async () => {
    expect(envSecrets(env, "collector-1")).toEqual({ current: "env-current", next: "env-next" });
    const none: StoredKeys = { lookup: async () => null };
    for (const stored of [undefined, none]) {
      expect(await resolveKey("collector-1", env, INGEST_KEY_BINDINGS, stored)).toEqual({
        binding: INGEST_KEY_BINDINGS["collector-1"],
        candidates: [
          { slot: "current", secret: "env-current" },
          { slot: "current", secret: "env-next" },
        ],
      });
    }
    expect(await resolveKey("nope", env, INGEST_KEY_BINDINGS, none)).toBeNull();
  });

  it("prefers the D1 row over the env binding", async () => {
    const row = {
      binding: { site: "demo", source: "kuma:watch-1" as const },
      candidates: [{ slot: "next" as const, secret: "d1-next", sealedNext: "v1.x.y" }],
    };
    const stored: StoredKeys = { lookup: async (id) => (id === "collector-1" ? row : null) };
    expect(await resolveKey("collector-1", env, INGEST_KEY_BINDINGS, stored)).toBe(row);
  });
});
