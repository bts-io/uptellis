/**
 * The test ingest keys. Signing keys live in the database only (src/worker/engine/key-store.ts), so the
 * integration and SSR projects (tests/integration/setup.ts) and the Docker tests seed a sealed row per test
 * key under the test master key (bound in vitest.config.ts), and the in-memory ingest tests use `memoryKeys`. Test-only strings, never real
 * keys.
 */
import type { Platform } from "@/platform/types";
import type { SourceId } from "@/shared/model";
import { schema } from "@/worker/db";
import { seal, sealingKey } from "@/worker/engine/seal";
import type { KeyBinding, KeyCandidate, StoredKeys } from "@/worker/ingest/keys";
import { TEST_KEYS } from "./signing";

/** The master key the test projects bind as `SOURCE_MASTER_KEY` (32 ASCII bytes, base64). */
export const TEST_MASTER_KEY = btoa("uptellis-test-master-key-32bytes");

/** The demo site's key ids, as an admin would create them for sites/demo.json. */
export const TEST_KEY_BINDINGS: Readonly<Record<"collector-1" | "facts-1", KeyBinding>> = {
  "collector-1": { site: "demo", source: "kuma:watch-1" },
  "facts-1": { site: "demo", source: "facts:app-1" },
};

/** Writes (or resets) the row of every test key: its `TEST_KEYS` secret sealed as current, no next. */
export async function seedTestKeys(
  platform: Pick<Platform, "db">,
  master: string = TEST_MASTER_KEY,
): Promise<void> {
  const key = await sealingKey(master);
  const now = Date.now();
  for (const [keyId, b] of Object.entries(TEST_KEY_BINDINGS)) {
    const currentSealed = await seal(key, TEST_KEYS[keyId as keyof typeof TEST_KEY_BINDINGS], keyId);
    const reset = { ...b, currentSealed, currentCreatedAt: now, nextSealed: null, nextCreatedAt: null };
    await platform.db
      .insert(schema.ingestKeys)
      .values({ keyId, ...reset, createdAt: now })
      .onConflictDoUpdate({ target: schema.ingestKeys.keyId, set: reset });
  }
}

export interface MemoryKey {
  site: string;
  source: SourceId;
  current?: string;
  next?: string;
}

/** Ingest keys in memory, for the in-memory backend: `next` promotes to current on first use. */
export function memoryKeys(keys: Record<string, MemoryKey>): StoredKeys & { promoted: string[] } {
  const promoted: string[] = [];
  return {
    promoted,
    async lookup(keyId) {
      const k = Object.hasOwn(keys, keyId) ? keys[keyId]! : null;
      if (!k) return null;
      const candidates: KeyCandidate[] = [];
      if (k.current) candidates.push({ slot: "current", secret: k.current });
      if (k.next) candidates.push({ slot: "next", secret: k.next, sealedNext: `sealed:${k.next}` });
      return { binding: { site: k.site, source: k.source }, candidates };
    },
    async promote(keyId, sealedNext) {
      const k = keys[keyId];
      if (!k?.next || sealedNext !== `sealed:${k.next}`) return;
      k.current = k.next;
      k.next = undefined;
      promoted.push(keyId);
    },
    async touch() {},
  };
}
