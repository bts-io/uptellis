/**
 * Worker secrets, which `wrangler types` cannot see from a clean checkout (set with `wrangler secret put`,
 * locally in .dev.vars). Declared as string to match what `wrangler types` emits when .dev.vars exists;
 * at runtime they may be absent, and the code treats an empty or missing value as unset.
 */
interface Env {
  /** Interim viewer key until Cloudflare Access. Unset means the gate is open (local dev). */
  VIEWER_KEY: string;
  /** HMAC secret for the uptellis_view cookie. Falls back to VIEWER_KEY alone when unset. */
  VIEWER_COOKIE_SECRET: string;
  /**
   * Admin key: `?admin=<key>` once sets the `uptellis_admin` cookie that opens `/admin` and `/api/admin/*`.
   * Unset means no admin in production (VIEWER_KEY set) and an open admin in local dev (both unset).
   */
  ADMIN_KEY: string;
  /**
   * 32 random bytes, base64: the master key that seals ingest secrets kept in D1 (AES-GCM, key derived with
   * HKDF). Required to create or rotate source keys; env-backed `INGEST_KEY_*` keys work without it.
   */
  SOURCE_MASTER_KEY: string;
  /** Ingest HMAC secret for key id `collector-1` (Kuma collector on watch-1, source kuma:watch-1). */
  INGEST_KEY_COLLECTOR_1: string;
  /** Ingest HMAC secret for key id `facts-1` (the facts pusher on app-1, source facts:app-1). */
  INGEST_KEY_FACTS_1: string;
  /** Rotation slot accepted alongside INGEST_KEY_COLLECTOR_1 while the producer moves to it. */
  INGEST_KEY_COLLECTOR_1_NEXT?: string;
  /** Rotation slot accepted alongside INGEST_KEY_FACTS_1 while the producer moves to it. */
  INGEST_KEY_FACTS_1_NEXT?: string;
  /**
   * A Discord channel webhook URL: one card when a source goes stale and one when it is back
   * (src/worker/notify). Unset means no cards.
   */
  DISCORD_WEBHOOK_URL: string;
}
