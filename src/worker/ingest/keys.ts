/**
 * Ingest key ids and what each may post. A key id is bound to exactly one site and one source, so the
 * facts key can never post a Kuma snapshot and the collector key can never post facts.
 *
 * Lookup order (`resolveKey`): keys stored in D1 first (src/worker/engine/key-store.ts: sealed secrets,
 * rotation through the admin API), then the env keys below. Env secrets are Worker secrets named
 * `INGEST_KEY_<ID>` (the key id upper-cased, `-` as `_`), plus an optional `INGEST_KEY_<ID>_NEXT` accepted
 * alongside it during a manual rotation: set `_NEXT`, move the producer to it, then copy it into the
 * current slot and delete `_NEXT`.
 */
import { type SourceId, type SourceKind, sourceKindOf } from "@/shared/model";

export interface KeyBinding {
  site: string;
  source: SourceId;
}

export type KeyBindings = Readonly<Record<string, KeyBinding>>;

export const INGEST_KEY_BINDINGS: KeyBindings = {
  "collector-1": { site: "demo", source: "kuma:watch-1" },
  "facts-1": { site: "demo", source: "facts:app-1" },
};

export type IngestRoute = "kuma" | "facts" | "events";

/** Which source kinds may post to which ingest route. */
export const ROUTE_SOURCE_KINDS: Readonly<Record<IngestRoute, readonly SourceKind[]>> = {
  kuma: ["kuma"],
  facts: ["facts"],
  events: ["webhook", "facts"],
};

export const routeAllows = (route: IngestRoute, source: SourceId) =>
  ROUTE_SOURCE_KINDS[route].includes(sourceKindOf(source));

/** `collector-1` -> `INGEST_KEY_COLLECTOR_1`. */
export const ingestSecretName = (keyId: string) => `INGEST_KEY_${keyId.toUpperCase().replace(/-/g, "_")}`;

/**
 * The `INGEST_KEY_*` secrets of the runtime (Worker secrets, or Docker env vars and files), as the entry
 * points read them. They are not `Platform` secrets: their names depend on the key ids.
 */
export type EnvIngestKeys = Readonly<Record<string, string>>;

const INGEST_SECRET_RE = /^INGEST_KEY_[A-Z0-9_]+$/;

/** The `INGEST_KEY_*` string values of an env object (everything else is left out). */
export function envIngestKeys(env: object): EnvIngestKeys {
  return Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] => INGEST_SECRET_RE.test(e[0]) && typeof e[1] === "string",
    ),
  );
}

const envValue = (v: unknown) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);

/**
 * The env secrets of a key id: `INGEST_KEY_<ID>` and `INGEST_KEY_<ID>_NEXT`, empty values as unset. Each is
 * trimmed, as every producer trims its copy (the collector's key file, push-facts.sh's env line), so a
 * secret stored with a trailing newline (`wrangler secret put < file`) still verifies. The HMAC key is the
 * UTF-8 bytes of the trimmed text on both sides.
 */
export function envSecrets(
  env: EnvIngestKeys,
  keyId: string,
): { current: string | null; next: string | null } {
  const name = ingestSecretName(keyId);
  return { current: envValue(env[name]), next: envValue(env[`${name}_NEXT`]) };
}

/** The env secrets for a key id, current first then next. */
export function secretsFor(env: EnvIngestKeys, keyId: string): string[] {
  const { current, next } = envSecrets(env, keyId);
  return [current, next].filter((v): v is string => v !== null);
}

/** One secret ingest may verify against: `current` (sealed in D1 or env) or `next` (sealed in D1). */
export interface KeyCandidate {
  slot: "current" | "next";
  secret: string;
  /** The sealed value of a D1 `next` slot, which promotion matches on. */
  sealedNext?: string;
}

/** A key id resolved for ingest: what it may post and the secrets to verify against, current first. */
export interface ResolvedKey {
  binding: KeyBinding;
  candidates: KeyCandidate[];
}

/** Keys stored in D1 (`KeyStore`); absent for the in-memory test backends. */
export interface StoredKeys {
  lookup(keyId: string): Promise<ResolvedKey | null>;
}

/** Resolves a key id: its D1 row if there is one, else its env binding and secrets, else null. */
export async function resolveKey(
  keyId: string,
  env: EnvIngestKeys,
  bindings: KeyBindings,
  stored?: StoredKeys,
): Promise<ResolvedKey | null> {
  const fromD1 = await stored?.lookup(keyId);
  if (fromD1) return fromD1;
  if (!Object.hasOwn(bindings, keyId)) return null;
  return {
    binding: bindings[keyId]!,
    candidates: secretsFor(env, keyId).map((secret) => ({ slot: "current", secret })),
  };
}
