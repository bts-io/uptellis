# Changelog

All notable changes to Uptellis are recorded here. The format follows [Conventional Commits](https://www.conventionalcommits.org) and the project uses [Semantic Versioning](https://semver.org). Each release adds its section in the release PR, from the Conventional Commits since the previous tag.

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
