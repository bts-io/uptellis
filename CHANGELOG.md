# Changelog

All notable changes to Uptellis are recorded here. The format follows [Conventional Commits](https://www.conventionalcommits.org) and the project uses [Semantic Versioning](https://semver.org). Each release adds its section in the release PR, from the Conventional Commits since the previous tag.

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
