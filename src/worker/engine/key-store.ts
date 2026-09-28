/**
 * Ingest keys kept in D1 (`ingest_keys`), sealed under `SOURCE_MASTER_KEY` (./seal.ts), next to the legacy
 * `INGEST_KEY_*` Worker secrets (src/worker/ingest/keys.ts), which keep working untouched.
 *
 * A row's `current` is either sealed in D1 or, while `currentSealed` is null, the env secret of the same
 * key id. Rotation writes a fresh secret into `next` (returned once); the first ingest that verifies with
 * `next` promotes it (current := next, next := null), which also retires an env secret for good. Ingest
 * touches `lastUsedAt` at most once a minute per key (an env key gets a row on first use to hold it).
 */
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Platform } from "@/platform/types";
import { type SourceId, sourceKindOf } from "@/shared/model";
import type { IssuedKey, SourceKey } from "@/shared/schemas/admin";
import { type Db, schema } from "@/worker/db";
import { toIso } from "@/worker/db/util";
import {
  type EnvIngestKeys,
  envSecrets,
  INGEST_KEY_BINDINGS,
  type KeyBinding,
  type KeyBindings,
  type KeyCandidate,
  type ResolvedKey,
  type StoredKeys,
  secretsFor,
} from "../ingest/keys";
import { randomSecret, seal, sealingKey, unseal } from "./seal";

const { ingestKeys } = schema;

type Row = typeof ingestKeys.$inferSelect;

/** `lastUsedAt` is written at most this often per key. */
export const TOUCH_INTERVAL_MS = 60_000;

/** Last `lastUsedAt` write per key id in this isolate (skips the D1 round trip in between). */
const touched = new Map<string, number>();

/** Forgets the per-isolate touch throttle (tests with a pinned clock). */
export function resetKeyTouches(): void {
  touched.clear();
}

const warn = (step: string, keyId: string, err: unknown) =>
  console.warn(
    JSON.stringify({ evt: "keys", step, keyId, name: err instanceof Error ? err.name : "unknown" }),
  );

const state = (createdAt: number | null, lastUsedAt: number | null): NonNullable<SourceKey["current"]> => ({
  createdAt: toIso(createdAt ?? 0),
  lastUsedAt: lastUsedAt === null ? null : toIso(lastUsedAt),
});

export class KeyStore implements StoredKeys {
  private readonly db: Db;
  private key: Promise<CryptoKey> | null = null;

  /**
   * `platform` supplies the database and `SOURCE_MASTER_KEY`, `env` the `INGEST_KEY_*` secrets (see
   * `envIngestKeys`), `bindings` the env key ids (the same default as the ingest routes).
   */
  constructor(
    private readonly platform: Pick<Platform, "db" | "batch" | "secret">,
    private readonly env: EnvIngestKeys,
    private readonly bindings: KeyBindings = INGEST_KEY_BINDINGS,
  ) {
    this.db = platform.db;
  }

  /** The derived sealing key; rejects with `MasterKeyMissing` when the master key is unset or malformed. */
  private sealer(): Promise<CryptoKey> {
    if (!this.key) {
      this.key = sealingKey(this.platform.secret("SOURCE_MASTER_KEY"));
      this.key.catch(() => {
        this.key = null;
      });
    }
    return this.key;
  }

  private async row(keyId: string): Promise<Row | undefined> {
    const [row] = await this.db.select().from(ingestKeys).where(eq(ingestKeys.keyId, keyId));
    return row;
  }

  /** True when the key id is taken, in D1 or as an env binding. */
  async exists(keyId: string): Promise<boolean> {
    return Object.hasOwn(this.bindings, keyId) || (await this.row(keyId)) !== undefined;
  }

  /**
   * The D1 row for a key id resolved to candidates, or null when D1 has none. A sealed slot that cannot be
   * opened (master key unset or changed) is skipped with a warning; an env-backed current comes from env.
   */
  async lookup(keyId: string): Promise<ResolvedKey | null> {
    const row = await this.row(keyId);
    if (!row) return null;
    const candidates: KeyCandidate[] = [];
    const open = async (sealed: string) => {
      try {
        return await unseal(await this.sealer(), sealed, keyId);
      } catch (err) {
        warn("unseal", keyId, err);
        return null;
      }
    };
    if (row.currentSealed) {
      const secret = await open(row.currentSealed);
      if (secret) candidates.push({ slot: "current", secret });
    } else {
      for (const secret of secretsFor(this.env, keyId)) candidates.push({ slot: "current", secret });
    }
    if (row.nextSealed) {
      const secret = await open(row.nextSealed);
      if (secret) candidates.push({ slot: "next", secret, sealedNext: row.nextSealed });
    }
    return { binding: { site: row.site, source: row.source as SourceId }, candidates };
  }

  /** Makes `next` the current key, if it is still the one that verified (a racing promotion is a no-op). */
  async promote(keyId: string, sealedNext: string): Promise<void> {
    await this.db
      .update(ingestKeys)
      .set({
        currentSealed: sql`${ingestKeys.nextSealed}`,
        currentCreatedAt: sql`${ingestKeys.nextCreatedAt}`,
        nextSealed: null,
        nextCreatedAt: null,
      })
      .where(and(eq(ingestKeys.keyId, keyId), eq(ingestKeys.nextSealed, sealedNext)));
  }

  /** Records a successful ingest; at most one write per key per `TOUCH_INTERVAL_MS`. */
  async touch(keyId: string, binding: KeyBinding, nowMs: number): Promise<void> {
    const last = touched.get(keyId);
    if (last !== undefined && nowMs - last < TOUCH_INTERVAL_MS && nowMs >= last) return;
    touched.set(keyId, nowMs);
    await this.db
      .insert(ingestKeys)
      .values({ keyId, site: binding.site, source: binding.source, lastUsedAt: nowMs, createdAt: nowMs })
      .onConflictDoUpdate({
        target: ingestKeys.keyId,
        set: { lastUsedAt: nowMs },
        setWhere: or(isNull(ingestKeys.lastUsedAt), lt(ingestKeys.lastUsedAt, nowMs - TOUCH_INTERVAL_MS)),
      });
  }

  /**
   * The site's keys: every D1 row plus the env bindings, which get a row (holding `createdAt` and
   * `lastUsedAt`, no secret) the first time they are listed. No secrets, sealed or not, leave this method.
   */
  async list(site: string, nowMs: number): Promise<SourceKey[]> {
    const envIds = Object.keys(this.bindings).filter((id) => this.bindings[id]!.site === site);
    if (envIds.length > 0) {
      await this.db
        .insert(ingestKeys)
        .values(
          envIds.map((keyId) => ({ keyId, site, source: this.bindings[keyId]!.source, createdAt: nowMs })),
        )
        .onConflictDoNothing();
    }
    const rows = await this.db
      .select()
      .from(ingestKeys)
      .where(eq(ingestKeys.site, site))
      .orderBy(ingestKeys.createdAt, ingestKeys.keyId);
    return rows.map((r) => {
      const env = envSecrets(this.env, r.keyId);
      return {
        keyId: r.keyId,
        source: r.source as SourceId,
        kind: sourceKindOf(r.source),
        store: r.currentSealed ? "d1" : "env",
        current: r.currentSealed
          ? state(r.currentCreatedAt ?? r.createdAt, r.lastUsedAt)
          : env.current
            ? state(r.createdAt, r.lastUsedAt)
            : null,
        next: r.nextSealed
          ? state(r.nextCreatedAt, null)
          : !r.currentSealed && env.next
            ? state(r.createdAt, null)
            : null,
      } satisfies SourceKey;
    });
  }

  /** The key id's binding for `site` (D1 row or env binding), or null when it is unknown there. */
  private async bindingFor(site: string, keyId: string): Promise<KeyBinding | null> {
    const row = await this.row(keyId);
    const binding = row
      ? { site: row.site, source: row.source as SourceId }
      : Object.hasOwn(this.bindings, keyId)
        ? this.bindings[keyId]!
        : null;
    return binding?.site === site ? binding : null;
  }

  /**
   * Issues a fresh secret into `next` (replacing an unused one) and returns it once. An env key is moved
   * into D1 by this: its env secret stays current until the new one is first used. Null for a key id the
   * site does not have.
   */
  async rotate(site: string, keyId: string, nowMs: number): Promise<IssuedKey | null> {
    const binding = await this.bindingFor(site, keyId);
    if (!binding) return null;
    const secret = randomSecret();
    const nextSealed = await seal(await this.sealer(), secret, keyId);
    await this.db
      .insert(ingestKeys)
      .values({ keyId, ...binding, nextSealed, nextCreatedAt: nowMs, createdAt: nowMs })
      .onConflictDoUpdate({ target: ingestKeys.keyId, set: { nextSealed, nextCreatedAt: nowMs } });
    return { keyId, source: binding.source, secret, slot: "next" };
  }

  /**
   * A new key for a source, as a statement to commit together with the config revision that adds the
   * source (a taken key id fails the whole batch), and the secret to return once.
   */
  async issue(
    site: string,
    source: SourceId,
    keyId: string,
    nowMs: number,
  ): Promise<{ statement: BatchItem<"sqlite">; issued: IssuedKey }> {
    const secret = randomSecret();
    const currentSealed = await seal(await this.sealer(), secret, keyId);
    const statement = this.db
      .insert(ingestKeys)
      .values({ keyId, site, source, currentSealed, currentCreatedAt: nowMs, createdAt: nowMs });
    return { statement, issued: { keyId, source, secret, slot: "current" } };
  }

  /** Runs a statement from `issue` on its own (a key for a source the config already has). */
  async commit(statement: BatchItem<"sqlite">): Promise<void> {
    await this.platform.batch([statement]);
  }
}
