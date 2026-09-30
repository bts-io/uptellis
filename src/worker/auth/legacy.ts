/**
 * Removed secrets an install may still set, each noticed once per process (isolate): the interim key gates
 * (create the owner account at `/setup`, then delete them) and the `INGEST_KEY_*` env ingest keys (create or
 * rotate the key in admin, then delete them).
 */
import { AUTH_PAGES } from "@/shared/schemas/auth";

export const LEGACY_SECRETS = ["VIEWER_KEY", "VIEWER_COOKIE_SECRET", "ADMIN_KEY"] as const;

let told = false;

/** Logs the notice when any legacy secret is set; `value` reads one by name (env, process env). */
export function warnLegacyKeys(value: (name: string) => string | undefined): void {
  if (told) return;
  told = true;
  const set = LEGACY_SECRETS.filter((name) => Boolean(value(name)));
  if (set.length === 0) return;
  console.warn(
    JSON.stringify({
      evt: "legacy_keys",
      set,
      message: `${set.join(", ")} ${set.length === 1 ? "is" : "are"} no longer used: open ${AUTH_PAGES.setup} to create the owner account, then remove ${set.length === 1 ? "it" : "them"}`,
    }),
  );
}

/** The env ingest keys of earlier releases (`INGEST_KEY_<ID>`, `INGEST_KEY_<ID>_NEXT`). */
export const LEGACY_INGEST_KEY = /^INGEST_KEY_[A-Z0-9_]+$/;

let toldIngest = false;

/**
 * Logs the notice when any `INGEST_KEY_*` secret is still set; `names` are the runtime's env names with a
 * non-empty value. Only names are logged. Requests signed with those keys get 401 `unknown_key`.
 */
export function warnLegacyIngestKeys(names: Iterable<string>): void {
  if (toldIngest) return;
  toldIngest = true;
  const set = [...names].filter((name) => LEGACY_INGEST_KEY.test(name)).sort();
  if (set.length === 0) return;
  console.warn(
    JSON.stringify({
      evt: "legacy_keys",
      set,
      message: `${set.join(", ")} ${set.length === 1 ? "is" : "are"} no longer read: ingest keys live in D1 only. Create or rotate each key under Admin > Sources, install the new secret on the producer, then remove ${set.length === 1 ? "it" : "them"}`,
    }),
  );
}
