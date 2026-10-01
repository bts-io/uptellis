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
  /**
   * The site a request gets when its host matches no site's `hostnames`; unset uses the only site, or the
   * first one created. It also turns on the committed `sites/<slug>.json` of that slug (the demo is `demo`).
   */
  SITE_DEFAULT?: string;
  /** GitHub OAuth app: sign-in with GitHub is offered when both the id and the secret are set. */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Google OAuth client: sign-in with Google is offered when both the id and the secret are set. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * 32 random bytes, base64: the master key that seals ingest secrets kept in D1 (AES-GCM, key derived with
   * HKDF). Required for signed ingest: every ingest key is sealed with it.
   */
  SOURCE_MASTER_KEY: string;
  /**
   * The historical Discord channel webhook URL (src/shared/notify `channelsOf`): stale and recovered cards
   * always, down and up with `notify.discord`. Other channels use `NOTIFY_*` secrets. Unset means no
   * cards on that channel.
   */
  DISCORD_WEBHOOK_URL: string;
}
