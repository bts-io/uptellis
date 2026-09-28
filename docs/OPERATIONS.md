# Operations

How to deploy Uptellis, create the first account, set and rotate its secrets, undo a config change, bring a stale producer back, and read what the Worker tells you. How the parts fit together is in [architecture.md](architecture.md); the security model behind all of this is in [SECURITY.md](SECURITY.md). Examples use the demo site `demo` at `status.example.com`; replace them with your own.

## Deploy

Uptellis runs on Cloudflare Workers today (D1, KV, Workers Static Assets, Rate Limiting, Cron Triggers). A Docker image with Bun and SQLite for any host follows in a later release ([roadmap.md](roadmap.md)).

### First deploy

1. Install and check: `bun install && bun run collector:install && bun run verify`.
2. Log in to Cloudflare: `bunx wrangler login` (or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in CI).
3. Create the D1 database and the KV namespace named in `wrangler.jsonc` and add the ids they print to their bindings (the migrations step needs the database before the first `wrangler deploy` could provision it):

   ```sh
   bunx wrangler d1 create uptellis-db
   bunx wrangler kv namespace create uptellis-cache
   ```

4. Write your site config as `sites/<slug>.json` (start from `sites/demo.json`), and set `SITE_DEFAULT` in `wrangler.jsonc` to its slug. To serve it on your own hostname, add a custom domain route to `wrangler.jsonc` and list the hostname in the config's `hostnames`.
5. Set the secrets ([below](#secrets)): at least `BETTER_AUTH_SECRET` and `SOURCE_MASTER_KEY`, and set `PUBLIC_URL` to the instance's URL (a var in `wrangler.jsonc`).
6. `bun run deploy`: applies the D1 migrations (`db:migrate:remote`), builds, and runs `wrangler deploy`.
7. Check it: `curl -s https://status.example.com/api/health` answers `{ ok, service, version, build, commit }`.
8. Create the owner account at once: [First run](#first-run).

### Later deploys

Run `bun run verify`, then `bun run deploy`, ideally from CI on merges to your release branch. `bun run deploy` is the only deploy path: it applies migrations before the new code is live.

- Every migration must work with the code that is deployed now: add first, drop in a later release.
- To roll back, revert the change and deploy again. A migration is never rolled back, only followed by a new one.
- `/api/health` reports the deployed `commit`, so a CI smoke step can wait until it matches.

### Bindings

| Binding | Kind | Used for |
| --- | --- | --- |
| `DB` | D1 `uptellis-db` | everything durable: models, heartbeats, incidents, configs, keys, nonces, notifications |
| `CACHE` | KV `uptellis-cache` | `latest:<site>` (assembled model) and `config:<site>` (current config) |
| `ASSETS` | Static Assets | client bundle and fonts from `dist/client` |
| `INGEST_RATE_LIMIT`, `GATE_RATE_LIMIT`, `ADMIN_WRITE_RATE_LIMIT` | Rate Limiting (namespace ids 1001 to 1003) | see [Rate limits](#rate-limits) |
| `SITE_DEFAULT` | var | the site a request renders when its host matches no site's `hostnames` |

## First run

The first account created becomes the owner, and only while no account exists, so claim a new instance right after its first deploy:

1. Open `https://status.example.com/setup` (or `/admin`, which sends you there while no account exists).
2. Enter your name, email and a password of 12 characters or more. You are signed in as the owner, and setup closes for good (`POST /api/setup` answers 409 from now on).
   Setup then shows the first site: the one this address serves (`SITE_DEFAULT` or a config listing the hostname), to confirm or adjust its name, hostname, visibility and theme, or a new one with its own slug. Either way you land in `/admin`.
3. Invite everyone else from the admin UI's users page: pick a role (`viewer` sees private sites, `admin` also edits configs, sources, API keys and users, `owner` also the instance settings) and, optionally, the one address that may use the invite. Send the one-time link over a private channel; it expires after 7 days.
4. Decide per site whether its page is `public` or `private` (the config's `visibility`; new sites are private).

```mermaid
sequenceDiagram
  participant O as Owner
  participant U as Uptellis
  participant P as Invited person
  O->>U: /setup (name, email, password)
  U-->>O: owner account, signed in, setup closed
  O->>U: first site (confirm or create)
  O->>U: invite (role, optional address)
  U-->>O: one-time link, valid 7 days
  O->>P: the link, over a private channel
  P->>U: /invite/<token> (name, email, password)
  U-->>P: account with the invite's role, signed in, link used up
```

An install upgraded from the key gates logs `evt: "legacy_keys"` while `VIEWER_KEY`, `VIEWER_COOKIE_SECRET` or `ADMIN_KEY` is still set: those keys no longer open anything. Create the owner at `/setup` (the page stays private or public by its config meanwhile), then delete them with `bunx wrangler secret delete <NAME>`.

Nobody can reset a forgotten password by email (Uptellis sends none). An owner or admin removes the account and invites the person again; the last owner cannot be removed, so keep a second owner.

### Sign-in with GitHub or Google

Optional; email and password always work. A provider is offered once both its client id (a setting) and its secret are set:

| Provider | Create | Callback URL | Setting | Secret |
| --- | --- | --- | --- | --- |
| GitHub | an OAuth app (Settings, Developer settings, OAuth Apps) | `<PUBLIC_URL>/api/auth/callback/github` | `GITHUB_CLIENT_ID` | `GITHUB_CLIENT_SECRET` |
| Google | an OAuth client of type web application (Google Cloud console, APIs and services, Credentials) | `<PUBLIC_URL>/api/auth/callback/google` | `GOOGLE_CLIENT_ID` | `GOOGLE_CLIENT_SECRET` |

Put the client id in `vars` of `wrangler.jsonc` (or the Docker env) and the secret with `bunx wrangler secret put`. A provider never creates an account: a signed-in user links it once, then can sign in with it.

## Crons

Three Cron Triggers in `wrangler.jsonc`, exactly the `JOBS` expressions of `src/platform/types.ts`; `src/platform/cloudflare/scheduled.ts` maps each trigger to its job (`src/worker/cron.ts`):

| Trigger | Job |
| --- | --- |
| `* * * * *` | edge probes of the configured public URLs |
| `*/5 * * * *` | downsample heartbeats, source staleness sweep, stale incidents and their cards |
| `17 3 * * *` (03:17 UTC) | retention pruning |

A newly added or changed cron trigger does not fire right after the deploy. Cloudflare takes several minutes to propagate it (its documentation says up to 15); in practice the first run of a new every-minute trigger can come 5 to 10 minutes after the deploy. Before suspecting the code, check the Worker's cron events in the Cloudflare dashboard or the scheduled invocations in the Workers analytics. Each run logs one JSON line (`evt: "cron"`, the job name and counts), see [Logs](#logs).

The integration tests (`tests/integration`) drive `runJob` with a pinned clock, which is the quickest way to see what a job does.

## Secrets

Worker secrets are set with `bunx wrangler secret put <NAME>`, which prompts for the value. Never pass a value on the command line or paste it into a chat or an issue. A `secret put` takes effect at once, without a deploy. Generate values with `openssl rand -hex 32` unless noted. For local development, put them in `.dev.vars` (gitignored; template in `.dev.vars.example`); without `BETTER_AUTH_SECRET` there are no accounts and only public sites can be seen.

| Secret | What it does | Rotating it |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | At least 32 random characters: signs the session cookies and encrypts the JWT signing keys. Without it there are no accounts | Everyone is signed out and the JWT keys must be replaced. See [Auth secret](#auth-secret) |
| `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET` | Optional: the OAuth client secrets ([Sign-in with GitHub or Google](#sign-in-with-github-or-google)) | Create a new secret at the provider, put it, then delete the old one there |
| `SOURCE_MASTER_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`): seals the ingest keys stored in D1 | Every key sealed in D1 stops verifying. See [Master key](#master-key) |
| `INGEST_KEY_<ID>` | Optional env fallback for a producer's HMAC key, used while its key id has no D1 row (binding in `src/worker/ingest/keys.ts`) | Rotate in admin instead, which moves the key into D1 ([Ingest keys](#ingest-keys)); then delete the env secret |
| `DISCORD_WEBHOOK_URL` | Optional: the Discord webhook the stale and recovered cards are posted to | In the channel settings create a new webhook, put its URL, send a test card (`POST /api/admin/notify/test`), then delete the old webhook |

The Worker only reads secrets; it never logs or returns them. Settings are plain vars: `PUBLIC_URL` (the instance's URL: the base of invite links, the JWT issuer and the origin Better Auth trusts; unset uses each request's origin, fine for local development only), `GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID` and `SITE_DEFAULT`.

### Auth secret

`BETTER_AUTH_SECRET` has no second slot. Changing it signs everyone out (their session cookies no longer verify) and leaves the JWT signing keys in the `jwks` table unreadable, so replace those too:

1. `bunx wrangler secret put BETTER_AUTH_SECRET` with a new value (`openssl rand -base64 32`).
2. Delete the old signing keys: `bunx wrangler d1 execute uptellis-db --remote --command "DELETE FROM jwks"`. The next token request creates a new key pair; services that verify Uptellis tokens pick the new key up from `/api/auth/jwks`.
3. Everyone signs in again. Accounts, roles, invites and API keys are untouched (API keys and invite tokens are stored as hashes, not under this secret).

### API keys

Pushers and agents that cannot sign in use an API key: one site, scopes `ingest`, `read` or both. Create one in the admin UI (or `POST /api/admin/sites/<slug>/api-keys` with `{ "name": "...", "scopes": ["ingest"] }`); the key is shown once. A producer sends it as `Authorization: Bearer <key>` with `X-Uptellis-Source: <source id>` (a source in that site's config) instead of the HMAC headers; a `read` key opens that site's page and read API even when it is private. Revoke a key (`DELETE .../api-keys/<id>`) the moment it is not needed or may have leaked; revoking is immediate. HMAC-signed producers keep working unchanged.

### Ingest keys

Each producer signs with its own key id, bound to one site and one source. Create and rotate keys in `/admin`, tab **Sources**:

- **Add a source** creates the source in the config (if it is new) and issues its key. The secret is shown once.
- **Rotate** on a key id issues a new secret. The old one keeps working until the producer's first request signed with the new one, which promotes it; from then on the old secret is rejected.

To rotate:

1. **Rotate** in the Sources tab and copy the new secret.
2. Install it on the producer and restart it (collector: its key file, see `collector/README.md`; a facts pusher: the `INGEST_KEY=` line of its env file).
3. The Sources tab shows the new key as current with a recent "last used".

The admin API does the same: `POST /api/admin/sites/<slug>/sources/<keyId>/rotate`. A key that was env-only (`INGEST_KEY_<ID>`) moves into D1 on its first rotation; delete the Worker secret once the producer uses the new key (`bunx wrangler secret delete INGEST_KEY_<ID>`). For a manual rotation without admin, `INGEST_KEY_<ID>_NEXT` is accepted alongside the current env secret: set it, move the producer to it, copy it into the current slot, delete `_NEXT`.

### Master key

`SOURCE_MASTER_KEY` has no second slot: after it changes, the keys sealed in D1 no longer open and their producers get 401 until they have a new key. Plan it as a short window (the collector buffers 60 minutes of heartbeats):

1. `bunx wrangler secret put SOURCE_MASTER_KEY` with a new value.
2. At once, rotate every key in the Sources tab (the new secrets are sealed with the new master key) and install each on its producer.
3. Watch the Sources tab until every source is fresh again.

## Restoring a config revision

Every save of a site config is a new revision in D1 (`site_configs`); nothing is overwritten.

1. Open `/admin`, tab **Revisions**. Revisions are listed newest first, with who saved them and a note.
2. **Restore** the version you want. Restoring saves it again as a new revision, so the history stays intact and the restore itself can be undone.
3. Pages pick it up within about 15 seconds (isolate cache, then KV `config:<site>`).

Tab **Import and export** exports `sites/<slug>.json` and imports one; run the import as a dry run first to see the diff. The same routes are in the admin API: `GET /api/admin/sites/<slug>/config/revisions` and `POST .../revisions/<version>/restore`.

## A producer is stale

A source is `aging` past 2 times its expected interval and `stale` past 5 times. The 5-minute cron opens a `stale` incident, the page shows the stale banner and, with `DISCORD_WEBHOOK_URL` set, a card is posted. `GET /api/sites/<slug>/sources` (signed in, or with a `read` API key, for a private site) lists each source's age and freshness.

```mermaid
flowchart TD
  s["source stale on the page"] --> kind{"which kind?"}
  kind -->|"kuma"| k1["collector host:<br/>docker ps, docker logs of the collector"]
  kind -->|"facts"| f1["pusher host:<br/>systemctl status of the timer,<br/>journalctl of the service"]
  kind -->|"webhook"| w1["the producer's own logs"]
  kind -->|"probe:cf"| p1["cron not firing:<br/>Workers cron events, recent deploy?"]
  k1 --> why{"last ingest status"}
  f1 --> why
  w1 --> why
  why -->|"401 skew"| clock["host clock: timedatectl, NTP"]
  why -->|"401 bad_signature or unknown_key"| key["key differs from the Worker:<br/>rotate in admin, install, restart"]
  why -->|"403 wrong_source"| route["key id bound to another source:<br/>posting to the wrong route"]
  why -->|"429"| rate["posting too often:<br/>look for a restart loop"]
  why -->|"5xx or no answer"| worker["Worker or network:<br/>/api/health, Cloudflare status"]
  why -->|"nothing sent"| proc["producer not running:<br/>restart it"]
```

Producers log JSON lines with status codes and reason codes only, so their logs are safe to read and paste.

- **Collector down, Kuma up.** `docker compose -f collector/compose.yaml up -d` from its checkout. Heartbeats from the last 60 minutes are sent on the next ticks; older gaps are backfilled from the last 100 beats per monitor that Kuma resends on login.
- **Kuma down.** The collector keeps posting with Kuma marked unreachable, so the page says Kuma is down rather than stale. Fix Kuma first.
- **Facts pusher.** Start its service once to push now; run the script with `--dry-run` to gather and sign without sending ([profiles/forgejo-ha](../profiles/forgejo-ha/README.md) shows a complete example).
- **Upgrades or reboots of a producer host** are best run detached (`systemd-run`) rather than in a foreground SSH session, and only when you have a second way in.

## Rate limits

Three Workers Rate Limiting bindings (in-memory limiters in Docker), applied first (`src/worker/middleware/rate-limit.ts`). Counters are kept per Cloudflare location, so the limits are approximate: a brake on floods and password guessing, not a quota. Over the limit the Worker answers 429 with `retry-after: 60`.

| Binding | Counts | Key | Limit |
| --- | --- | --- | --- |
| `INGEST_RATE_LIMIT` | `POST /api/ingest/*`, before the HMAC check | claimed key id and client IP | 60 per minute |
| `GATE_RATE_LIMIT` | sign-in attempts (email sign-in, setup, accepting an invite), and requests answered 401, 403 or 404 outside ingest | client IP | 20 per minute |
| `ADMIN_WRITE_RATE_LIMIT` | non-GET requests to admin paths | client IP | 30 per minute |

The collector posts once a minute and a facts pusher typically every 15 minutes, so 60 per minute leaves room for a catch-up burst. A producer that hits 429 is almost always in a restart loop. To change a limit, edit `ratelimits` in `wrangler.jsonc` and deploy. Allowed page views and API reads, and `/api/health`, are never counted.

## Logs

The Worker logs JSON lines with an `evt` field, reason codes, ids and counts, and only the error name on failure. It never logs a payload, key, password, cookie, request body or SQL.

| `evt` | When | Fields |
| --- | --- | --- |
| `ingest` | every ingest request | `route`, `status`, `reason` on a rejection, `keyId`, `source`, counts of services, heartbeats, facts, incidents opened and resolved; `step: "key_promoted"` when a rotated key takes over |
| `cron` | every cron run | `job` (`probes`, `five-minute`, `daily`), incidents opened and resolved; for probes also sites, checks, down results and failed sites |
| `notify` | every card | `kind` (`open`, `resolve`), `sent`, the error code on failure |
| `legacy_keys` | once per isolate or process while an old gate secret is still set | `set` (the names), a message pointing at `/setup` |
| `error` | an unhandled error | `name` only |

Read them live with `bunx wrangler tail --format json`, or in the Workers Logs view of the dashboard (`observability` is on in `wrangler.jsonc`). Workers invocation logs are off on purpose: they record each request's URL, and invite links carry their one-time token in the path. Keep them off.

Error responses carry a code and a fixed message (`{ "error": "internal", "message": "Something went wrong" }`); ingest rejections add a reason (`missing_headers`, `malformed_headers`, `skew`, `unknown_key`, `bad_signature`, `wrong_source`, and for API keys `bad_api_key`, `scope`) or the error `replay` or the field paths that failed validation, never values.
