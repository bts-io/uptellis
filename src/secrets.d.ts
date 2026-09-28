/**
 * Worker secrets, which `wrangler types` cannot see from a clean checkout (set with `wrangler secret put`,
 * locally in .dev.vars). Declared as string to match what `wrangler types` emits when .dev.vars exists;
 * at runtime they may be absent, and the code treats an empty or missing value as unset.
 */
interface Env {
  /**
   * At least 32 random characters: signs session cookies and encrypts the JWT signing keys (Better Auth).
   * Unset means no accounts: everyone is anonymous and only public sites can be seen.
   */
  BETTER_AUTH_SECRET: string;
  /** The public URL of this instance (`https://status.example.com`); unset uses the request's origin. */
  PUBLIC_URL?: string;
  /** GitHub OAuth app: sign-in with GitHub is offered when both the id and the secret are set. */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Google OAuth client: sign-in with Google is offered when both the id and the secret are set. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
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
