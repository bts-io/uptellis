# Changelog

All notable changes to Uptellis are recorded here. The format follows [Conventional Commits](https://www.conventionalcommits.org) and the project uses [Semantic Versioning](https://semver.org). Each release adds its section in the release PR, from the Conventional Commits since the previous tag.

## 0.6.0 (2026-10-01)

### Features

* **SMS through Twilio:** a new `sms` channel texts one number per channel through your own Twilio account (`accountSid`, the auth token as a `NOTIFY_*` secret, a `from` number or Messaging Service, one `to` number). It sends `down` and `up` by default, since every text costs money. Texts are plain ASCII of at most 160 characters with the status page link kept, and Twilio's errors become short codes in the delivery log (`bad_token`, `invalid_number`, `unverified_number`, ...); a number, SID or token never appears in a log or anything public. Setup, including the trial account's limits, is in `docs/monitors.md`. Tested against Twilio's Messages API in the test suite; a live text from a real Twilio account is still to be checked.
* **Plain webhooks:** a webhook channel's `signingSecret` is now optional; without it the alert is a plain JSON POST (no `X-Uptellis-Signature`). A new optional `authSecret` is sent as the `Authorization` header as is (for example `Bearer <token>`), for n8n, Home Assistant and similar receivers. Signed webhooks are unchanged.
* **Admin:** the channel editor has the SMS fields and the optional webhook fields.

### Bug Fixes

* A source removed from the config no longer shows in the site's sources report, and the page's updated time counts only the sources the site lists. An ingest key of a retired source stays in Admin, Sources, marked "not in the config", and can still be rotated.

### Documentation

* Setup guides for Telegram, SMS (Twilio) and webhooks in `docs/monitors.md`; the roadmap moves Microsoft Teams to "Later".

## 0.5.0 (2026-10-01)

### ⚠ BREAKING CHANGES

* **ingest:** the `INGEST_KEY_<ID>` and `INGEST_KEY_<ID>_NEXT` env secrets are no longer read; ingest keys live in D1 only. A producer still signing with one gets 401 `unknown_key` (with a hint in the log) until its key is rotated or created under Admin > Sources, and the server logs the leftover secret names once at startup. See the upgrade path in `docs/OPERATIONS.md`.

### Features

* Six new themes, chosen from mock-ups: **Classic** (`d-classic`, the familiar hosted status page), **Editorial** (`e-editorial`, reads like a report), **Dashboard** (`f-dashboard`, cards and charts, light and dark), **Wallboard** (`g-wallboard`, for a TV: paging, capped alerts, readable from across a room), **Friendly** (`h-friendly`, plain language) and **Minimal** (`i-minimal`, one line and a compact list). Pick one per site in admin, or preview any with `?theme=`.
* Self-hosted fonts for the new themes (Inter, Fraunces, Source Serif 4, Manrope, Barlow Semi Condensed, Nunito), all SIL OFL 1.1; see `public/fonts/LICENSES.md`.
* Themes Control Room and Session regain the profile details they lost in 0.2.0 (coloured group tiles and lines, state dots, the pair caption, the standby lag, the fence timelines), and sys.status wraps long infrastructure rows.
* README screenshots of every theme.
* `bun run a11y`: an axe-core audit of every theme, fixture, phone and desktop width, light and dark (WCAG 2.2 A and AA plus best practices); see `docs/THEMES.md`.
* Theme contract additions: a section with none of its services in the model is left out of `sections`; `RegisteredTheme` gains `themeColorDark` (Dashboard and Minimal send a light and a dark `theme-color`) and `fonts` (each page preloads only its theme's fonts).
* A `maintenance` verdict (contract addition): when no service is up, down or degraded and at least one is in a maintenance window, the view's verdict is "N services under maintenance" and every theme says so, instead of "All systems operational" next to "0 of N up". The public `summary.json`, badges and embed report `maintenance` too.

### Bug Fixes

* A monitor removed from a site's config no longer stays on the page, in the public summary or on badges; its open incident is resolved quietly by the five-minute job, with a note and no card. Its history is kept.
* Agent CLI tests get a 20 s timeout (they spawn the binary and timed out under load).
* All nine themes pass the accessibility audit: faint and muted text reach AA contrast (sys.status, Control Room, Session, Classic, Dashboard light, Minimal light), Classic's operational banner and Friendly's accent links are darker, sys.status has a `main` landmark, and status notices no longer put `role` on `aside`.
* Wallboard tile names get the full tile width, with the state word on its own row, so typical names no longer truncate on a wall screen.
* No theme renders an empty section header for a section whose services are not reported.
* Control Room and Session no longer list replication and the fence twice beside the failover pair; a stale standby lag keeps its last value, marked stale.
* `notify.webhooks` (never read since 0.4.0) is dropped when a config is parsed, so exports, revisions and the admin JSON omit it; old configs still load.
* A source removed from the config (a retired collector, facts pusher or webhook) leaves the page: its services and facts are no longer shown as stale forever, and an open incident of one of its services is resolved quietly by the five-minute job, with a note and no card. Its history is kept.
* The accessibility audit now also covers Dashboard and Minimal (it skipped registry entries written over several lines) and the maintenance fixture.
* A check without a latency that is not down (maintenance, paused) no longer reads as a failure: sys.status, Control Room and Session say "timeout" or "no response" only for a down check and show a dash otherwise, Dashboard's latency bars stay faint instead of red, and sys.status fits the status word ("maint") in its recent checks.
* A topology with no facts at all (a new install before its pusher reports, or a retired facts source) no longer claims "replication stopped": sys.status, Control Room and Session draw the edge muted as "no data" without an error count, and the Forgejo HA profile's headline and wal row say nothing is known. A replication fact that says stopped still shows red. Themes get `edgeState` from `@/shared/view` (contract addition).

## 0.4.0 (2026-09-29)

### Features

* Notification channels ([docs/monitors.md](docs/monitors.md#cards)): `notify.channels` per site, of type `discord`, `slack`, `webhook` (signed with HMAC-SHA256 as `X-Uptellis-Signature: t=...,v1=...`), `ntfy`, `telegram` or `email`, each with the events it wants (`down`, `up`, `stale`, `recovered`) and an optional service filter. Channels name their secrets (`NOTIFY_*`); values never enter the config.
* One alert message for every channel, sent once per channel and incident transition (the delivery log in the `notifications` table). Retryable failures are retried with backoff and then by the five-minute job for up to an hour, and a failing channel never blocks the others.
* Email through Cloudflare Email Service: the `send_email` binding on Cloudflare (`DEPLOY_EMAIL_FROM` in `bun run deploy:config` turns it on), and the Email Service REST API or SMTP in Docker.
* Public status ([docs/public.md](docs/public.md)): `GET /api/public/:site/summary.json` with only the parts `public.fields` allows, shields-style SVG badges for the site and each service (status or 90-day uptime), and an embeddable widget (`/embed/:site` for an iframe, `/embed.js` for a script). Only for public sites with `public.enabled`; private sites are always 404.
* Admin: a channel editor with "send test" per channel, the delivery log, and public settings with the badge and embed snippets.
* `POST /api/admin/notify/test` takes `channel=<id>`.

### Compatibility

* A site without `notify.channels` behaves as before: stale and recovered Discord cards on `DISCORD_WEBHOOK_URL`, and down and up cards when `notify.discord` is on.
* Migration 0006 adds the channel and retry columns to `notifications`; existing rows belong to the historical Discord channel.
* `notify.webhooks` was never read and is now documented as unused; use `channels`.

## 0.3.1 (2026-09-28)

### Bug Fixes

* Sources removed from the config (a retired agent, a dropped collector) no longer go stale and page forever. Only the sources a site lists or implies are swept, and an open stale incident of a removed source is resolved with a note and no card.
* No "Data is stale" banner or verdict while a maintenance window covers the whole site; the maintenance notice shows instead.

### Features

* `POST /api/admin/notify/test` also sends TEST `down` and `up` cards (`kind=down|up`, optional `service=<id>`), so a webhook can be checked for every card kind.

## 0.3.0 (2026-09-28)

### Features

* Native monitors ([docs/monitors.md](docs/monitors.md)): `http` (status range, keyword, never following redirects), `tcp`, `ping` and `tls` (days left, degraded under a threshold), defined per site in `monitors` and edited in admin. The legacy `probes` run as `http` monitors with the same service ids, so their history carries over.
* Runners: `builtin` runs on the instance itself (Cloudflare's edge: `http` and `tcp`; the Docker server: all four), and agents run inside private networks. Each runner reports as its own source, so a silent agent raises a stale incident.
* `uptellis-agent`: a small Bun program that fetches its monitors (`GET /api/agent/v1/monitors`, ETag), runs them aligned to the minute and posts results (`POST /api/agent/v1/results`). Results are buffered on disk and delivered in order after an outage. Ships as single binaries for linux amd64 and arm64 on the GitHub release, an image (`ghcr.io/bts-io/uptellis-agent`), and a hardened systemd unit ([agent/README.md](agent/README.md)).
* Confirmation: retries per runner and a quorum across runners before a service is down. Too few agreeing runners show degraded, and a failing but unconfirmed runner shows pending.
* Maintenance windows: one-off and weekly, in any time zone (daylight saving and midnight crossing handled). They apply to any service of the site; covered services show maintenance, open no incident and send no card.
* Down and up cards for services in the existing Discord card style, once per incident, with the outage duration on recovery. They are sent when the site's `notify.discord` is on.
* API keys gain the `agent` scope; sites gain `agents`. A service kind `tls` is added.
* The admin editor covers monitors, agents and maintenance windows, with per-field validation and hints on what the edge cannot run.
* The Docker image ships `ping`, and `compose.yaml` enables unprivileged ICMP.

### Bug Fixes

* Two runners of one monitor that report in the same second no longer leave the status one interval behind: each request confirms again after saving its runner state.
* Confirmation uses the site's maintenance windows, so a window never opens an incident.

### Notes

* On Cloudflare, `tcp` from the edge cannot reach hosts behind Cloudflare itself (a Workers socket limit). Use an `http` monitor or an agent for those.
* Probes no longer need a listed `probe:cf` source; runner sources are implied by the monitors.

## 0.2.1 (2026-09-28)

### Bug Fixes

* A flaky API key test: the key's secret can contain underscores, so the test now takes everything after the prefix.

### Chores

* Brand assets (marks, icons, brand guide) moved out of the repository; the README keeps its logo, now in `docs/assets/`.

## 0.2.0 (2026-09-28)

### Features

* Runs in Docker as well as on Cloudflare: one app behind a platform interface, a Bun server with SQLite, a built-in scheduler and in-memory rate limits; a multi-arch image (amd64, arm64) with a smoke test, and `compose.yaml` with a data volume.
* Accounts with Better Auth: first-run setup of the owner, sign-in with email and password and optional GitHub and Google, roles (owner, admin, viewer), one-time invites, JWTs with a JWKS endpoint, and site-scoped API keys for producers (`Authorization: Bearer`, alongside signed ingest).
* Public or private sites: private sites answer 404 to anyone without a role; pages redirect to sign-in.
* Profiles: fact groups, labels, formats, thresholds, highlights and topology come from profiles (`generic`, `uptime-kuma`, `forgejo-ha`), so the view-model and themes no longer name any system's facts.
* Account screens: setup, sign-in, invite acceptance, account page, users and invites, API keys, and visibility and profiles in the config form.
* `bun run deploy:config` prepares `wrangler.jsonc` from environment variables, to deploy to your own account without committing resource ids.

### Bug Fixes

* The demo site's first probe points at a URL that exists, so a fresh install shows no false outage.

### Breaking Changes

* The viewer key and admin key gates (`VIEWER_KEY`, `VIEWER_COOKIE_SECRET`, `ADMIN_KEY`) are removed; after upgrading, open `/setup` to create the owner account. `BETTER_AUTH_SECRET` is required.
* The migrate scripts address the database by its binding (`DB`) instead of its name.

## 0.1.1 (2026-09-28)

### Bug Fixes

* Project links point at the GitHub organization `bts-io`.

### Documentation

* Releases are cut on Forgejo with signed tags and pull requests merge fast-forward; the GitHub mirror publishes releases and images from the tags.

## 0.1.0 (2026-09-28)

### Features

* Initial public import from the internal prototype.
