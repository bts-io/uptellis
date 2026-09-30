/**
 * Ingest key ids and what each may post. A key id is bound to exactly one site and one source, so the
 * facts key can never post a Kuma snapshot and the collector key can never post facts.
 *
 * Signing keys live only in D1 (src/worker/engine/key-store.ts: sealed secrets, created and rotated in
 * admin). The `INGEST_KEY_<ID>` env secrets of earlier releases are no longer read.
 */
import { type SourceId, type SourceKind, sourceKindOf } from "@/shared/model";

export interface KeyBinding {
  site: string;
  source: SourceId;
}

export type IngestRoute = "kuma" | "facts" | "events";

/** Which source kinds may post to which ingest route. */
export const ROUTE_SOURCE_KINDS: Readonly<Record<IngestRoute, readonly SourceKind[]>> = {
  kuma: ["kuma"],
  facts: ["facts"],
  events: ["webhook", "facts"],
};

export const routeAllows = (route: IngestRoute, source: SourceId) =>
  ROUTE_SOURCE_KINDS[route].includes(sourceKindOf(source));

/** One secret ingest may verify against: `current` or `next`, both sealed in D1. */
export interface KeyCandidate {
  slot: "current" | "next";
  secret: string;
  /** The sealed value of a `next` slot, which promotion matches on. */
  sealedNext?: string;
}

/** A key id resolved for ingest: what it may post and the secrets to verify against, current first. */
export interface ResolvedKey {
  binding: KeyBinding;
  candidates: KeyCandidate[];
}

/** The ingest keys signed requests are verified with (`KeyStore` in D1, an in-memory one in tests). */
export interface StoredKeys {
  /** The key id's binding and secrets, or null when there is no such key. */
  lookup(keyId: string): Promise<ResolvedKey | null>;
  /** Makes `next` the current key, if it is still the one that verified. */
  promote(keyId: string, sealedNext: string): Promise<void>;
  /** Records a successful ingest. */
  touch(keyId: string, binding: KeyBinding, nowMs: number): Promise<void>;
}

/**
 * Logged with every `unknown_key` 401: the signing key id has no usable secret in D1. An install that still
 * sets `INGEST_KEY_*` env secrets lands here, since those are no longer read.
 */
export const UNKNOWN_KEY_HINT =
  "no ingest key with a usable secret for this key id: create or rotate it under Admin > Sources (INGEST_KEY_* env secrets are no longer read)";
