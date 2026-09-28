<p align="center">
  <picture>
    <source srcset="docs/assets/uptellis-logo.svg" type="image/svg+xml">
    <img src="docs/assets/uptellis-logo.png" alt="Uptellis" width="420">
  </picture>
</p>

<p align="center"><strong>Uptime, tell us.</strong> A self-hosted status page and monitor, on Cloudflare or in Docker.</p>

<p align="center">
  <a href="https://github.com/bts-io/uptellis/actions/workflows/ci.yml"><img src="https://github.com/bts-io/uptellis/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/bts-io/uptellis" alt="License: MIT"></a>
  <a href="https://github.com/bts-io/uptellis/releases/latest"><img src="https://img.shields.io/github/v/release/bts-io/uptellis?sort=semver" alt="Latest release"></a>
  <a href="https://github.com/bts-io/uptellis/pkgs/container/uptellis"><img src="https://img.shields.io/badge/image-ghcr.io-blue?logo=docker&logoColor=white" alt="Container image on GHCR"></a>
</p>

Uptellis collects health data from the tools you already run, keeps it in one normalized model, and renders it as a fast, server-side rendered status page. Sources sign what they send, each site's page is public or private behind real accounts, and everything is configured from an admin panel with a full revision history.

## Features

- **Status page with three themes**: sys.status, Control Room and Session, all sharing a command palette (`/` or Ctrl/Cmd+K) and keyboard shortcuts. Preview another theme with `?theme=<id>` without saving it.
- **Monitors from the tools you run**: today through an Uptime Kuma collector, infrastructure facts pushed by a script on your hosts, and edge probes the Worker runs itself every minute. Native monitors built into Uptellis are on the roadmap.
- **Incidents**: a service going down opens an incident and recovery resolves it; a source that stops reporting is flagged stale. The page shows 90 days of history.
- **Discord alerts**: one card when a source goes silent and one when it recovers, sent at most once however often a check runs.
- **Admin with revisions**: edit the site as a form or raw JSON, see a diff before saving, restore any earlier revision, import and export the site config.
- **Accounts and roles**: sign-in with email and password, optionally GitHub or Google (Better Auth); owner, admin and viewer roles; the first account becomes the owner and everyone else joins by a one-time invite. Each site is public or private.
- **API keys and JWTs**: site-scoped API keys (`ingest`, `read`) for pushers and agents, shown once and revocable; short-lived JWTs for the signed-in user, verifiable by other services through the JWKS at `/api/auth/jwks`.
- **Key rotation**: ingest keys are created and rotated in admin, stored sealed with AES-GCM, and a rotation switches over when the producer first signs with the new secret.
- **Rate limits and hardening**: signed ingest (HMAC-SHA256 with replay protection), per-client rate limits on ingest, sign-in attempts and admin writes, body size caps and strict security headers.

## Screenshots

Screenshots of the three themes and the admin panel will be added with the first public release.

## Architecture

```mermaid
flowchart LR
  subgraph hosts ["Your infrastructure"]
    kuma["Uptime Kuma"] -->|"socket.io"| col["Uptellis collector<br/>container"]
    facts["facts script<br/>timer on a host"]
  end
  subgraph worker ["Cloudflare Worker"]
    ingest["/api/ingest/*<br/>HMAC, nonce, Zod"] --> engine["adapters<br/>incidents"]
    cron["crons: edge probes,<br/>downsampling, staleness, retention"] --> engine
    engine --> d1[("D1")]
    engine --> kv[("KV cache")]
    api["Hono /api/*"] --> kv
    api --> d1
    ssr["TanStack Start SSR<br/>status page and admin"] -->|"in-process"| api
  end
  col -->|"signed POST"| ingest
  facts -->|"signed POST"| ingest
  cron -->|"https checks"| sites["your public URLs"]
  engine -->|"stale and recovered cards"| discord["Discord webhook"]
  visitor["Visitors"] --> ssr
```

One app, two runtimes: a Cloudflare Worker (D1, KV, Cron Triggers) or a Docker container (Bun, one SQLite file, a built-in scheduler), behind one platform interface. Hono owns `/api/*`, TanStack Start (React 19) renders every page on the server, and page loaders call the API in-process. Data lives in SQL through Drizzle, the assembled model is cached, and every payload is validated with Zod.

## Install

Both install paths are **coming in v1.0**.

- **Deploy to Cloudflare** (coming in v1.0): a one-click button that creates the Worker, D1 database and KV namespace in your Cloudflare account.
- **Docker image** (coming in v1.0): `ghcr.io/bts-io/uptellis`, multi-arch, signed with cosign, with an SBOM and provenance attestation.

Until then, run it from source as described below, or build and run the Docker image from a checkout: copy `docker.env.example` to `docker.env`, then `docker compose up -d --build` ([OPERATIONS.md](docs/OPERATIONS.md#docker)).

## Develop

Requires [Bun](https://bun.sh).

```sh
bun install
bun run collector:install        # the collector has its own lockfile
cp .dev.vars.example .dev.vars   # optional; empty keys leave the page and admin open locally
bun run dev                      # open the printed URL; /api/health answers JSON
```

Before every push:

```sh
bun run verify   # Biome, typecheck, unit + integration + SSR tests, Docker adapter tests, collector tests
```

More in [docs/](docs): [THEMES.md](docs/THEMES.md) (themes and the view model), [profiles.md](docs/profiles.md) (what facts mean: built-in profiles and writing one), [SECURITY.md](docs/SECURITY.md) (threat model, accounts, roles, API keys, rate limits) and [OPERATIONS.md](docs/OPERATIONS.md) (first run, OAuth, Cloudflare and Docker deploys, secrets, rotation, backups, restoring a revision).

## Branches and releases

`main` only ever holds released code; work lands on `staging` through pull requests from `feat/*`, `fix/*` and `docs/*` branches, and a release PR takes `staging` to `main`. Commits follow [Conventional Commits](https://www.conventionalcommits.org), versions follow [SemVer](https://semver.org), and every release is a signed tag with its notes in the [changelog](CHANGELOG.md). The full workflow is in [CONTRIBUTING.md](CONTRIBUTING.md).

Please report security problems privately as described in [SECURITY.md](SECURITY.md), and read the [Code of Conduct](CODE_OF_CONDUCT.md) before taking part.

## License

[MIT](LICENSE), copyright the Uptellis authors.
