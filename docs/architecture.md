# Architecture

Uptellis ("uptime, tell us") is a self-hostable status page and monitor. Producers you run next to your systems, and checks the Worker runs itself, report into one normalized model; a pure function turns that model into a view; swappable themes render the view. This page describes how the pieces fit together today. Running it is in [OPERATIONS.md](OPERATIONS.md), the security model in [SECURITY.md](SECURITY.md), themes and the component kit in [THEMES.md](THEMES.md), and what comes next in [roadmap.md](roadmap.md).

## Runtime

One Cloudflare Worker (`src/server.ts`) serves everything:

- **Hono** owns `/api/*` and `/embed/*` (`src/worker/index.ts`): ingest, the read API, the admin API and `/api/health`.
- **TanStack Start** (React 19) server-renders every other path: the status page, `/admin` and, under `vite dev` only, `/_preview`.
- SSR loaders call the Hono app **in-process** through an API bridge (`src/client/lib/api.ts`): same app, same env, no network hop.
- **D1** (through Drizzle, `src/worker/db/schema`, migrations in `migrations/`) is the source of truth. **KV** caches the assembled model (`latest:<site>`) and the current config (`config:<site>`).
- **Zod 4** schemas in `src/shared` validate every payload, config and API body, on the Worker and in the producers.
- Static assets (client bundle, fonts) are served by Workers Static Assets and never reach the Worker.
- The Worker's `scheduled` handler runs three crons (see [Crons](#crons)).

## Data flow

```mermaid
flowchart LR
  subgraph producers ["Your hosts"]
    kuma["Uptime Kuma"] -->|"socket.io, one session"| col["Kuma collector<br/>every 60 s, 60 min buffer"]
    push["facts pusher<br/>(a profile, systemd timer)"]
    hook["any producer<br/>signed webhooks"]
  end
  subgraph worker ["Cloudflare Worker"]
    ing["/api/ingest/kuma, facts, events<br/>size cap, HMAC, nonce, Zod"]
    probes["edge probes<br/>every-minute cron"]
    adapt["adapters<br/>payload to ModelDelta"]
    store["store: apply delta,<br/>derive incidents"]
    d1[("D1")]
    kv[("KV<br/>latest:site, config:site")]
    build["buildSiteView<br/>(pure)"]
    read["/api/sites/:site/view"]
    page["theme Page (SSR)"]
    notify["notifier<br/>Discord cards"]
  end
  col -->|"signed POST"| ing
  push -->|"signed POST"| ing
  hook -->|"signed POST"| ing
  ing --> adapt
  probes --> adapt
  adapt --> store
  store --> d1
  store --> kv
  store -->|"stale transitions"| notify
  kv --> read
  d1 --> read
  read --> build
  build --> page
```

Every producer reports as one **source**. There are four source kinds, each with its own ingest route and adapter (`src/worker/adapters`):

| Kind | Producer | Route | What it carries |
| --- | --- | --- | --- |
| `kuma` | the Kuma collector (`collector/`), a Bun service next to Uptime Kuma | `POST /api/ingest/kuma` | a `KumaSnapshot`: monitors, their heartbeats since the last send, uptime, certificates, Kuma metadata as facts |
| `facts` | a facts pusher, usually a shell script on a timer (see [profiles](../profiles/forgejo-ha/README.md)) | `POST /api/ingest/facts` | a `FactsPayload`: typed facts in named groups |
| `webhook` | anything that can sign a request | `POST /api/ingest/events` | an `EventsPayload`: services it declares, their heartbeats, optional facts |
| `probe` | the Worker itself (source `probe:cf`) | none: the every-minute cron | one heartbeat per configured HTTP check |

A signed request goes through the checks in [SECURITY.md](SECURITY.md#ingest) (body size, signature, key binding, nonce, schema). The adapter turns the payload into a `ModelDelta`; the store writes it to D1 in one batch, derives incidents, assembles the site model and puts it in KV. The probe cron builds the same kind of delta and goes through the same path (`applyIngestDelta` in `src/worker/engine/ingest-service.ts`), so probe results move heartbeats, incidents and freshness exactly as a Kuma snapshot does.

Two details keep the history exact:

- A delta whose `generatedAt` is older than its source's last accepted one is **history only**: its heartbeats are stored (idempotently, never opening or closing incidents), but services, facts and `latest:<site>` are left alone. The collector's 60 minute buffer and Kuma resending its last 100 beats per monitor on reconnect fill short gaps this way.
- Every accepted payload is also kept raw for 7 days (`snapshots`) for debugging.

### Signed ingest

```mermaid
sequenceDiagram
  participant P as Producer
  participant W as Worker
  participant D as D1
  participant K as KV
  P->>W: POST /api/ingest/facts (signed headers, JSON body)
  W->>W: body at most 256 KB
  W->>D: look up key id (sealed key, else env secret)
  W->>W: HMAC-SHA256 over v1, key id, ts, nonce, method, path, body hash
  W->>W: key id bound to this site and a source this route accepts
  W->>D: claim nonce (single use for 1 hour)
  W->>W: JSON, Zod schema, display-safety checks
  W->>D: apply delta, derive incidents (one batch)
  W->>K: put latest:site
  W-->>P: 202 with ids and counts
```

The signature scheme lives in `src/shared/signing.ts`, shared by the Worker (verify) and the collector (sign); the facts pusher implements the same canonical string in shell. Details and status codes: [SECURITY.md](SECURITY.md#ingest).

## Model

The model is defined in `src/shared/model` and stored in D1.

```mermaid
erDiagram
  SITE ||--o{ SOURCE : "reported by"
  SITE ||--o{ SERVICE : has
  SOURCE ||--o{ SERVICE : owns
  SOURCE ||--o{ FACT : reports
  SERVICE ||--o{ HEARTBEAT : has
  SERVICE ||--o{ INCIDENT : "down incidents"
  SOURCE ||--o{ INCIDENT : "stale incidents"
  SITE ||--o{ CONFIG_REVISION : "configured by"
  SOURCE ||--o| INGEST_KEY : "signs with"
```

- **Site.** A slug (the key of every row), a name and the hostnames it answers on. Each site has a config (below). The demo site is `demo`, "Acme Cloud", at `status.example.com`.
- **Source.** One producer, id `<kind>:<name>` (for example `kuma:watch-1`, `facts:app-1`, `probe:cf`), with an expected interval from the config and the time it was last seen. Its **freshness** at any moment is `fresh` below 2 times the expected interval, `aging` up to 5 times, `stale` beyond, and `empty` when it has never reported (`sourceFreshness` in `src/shared/model/source.ts`).
- **Service.** A monitored thing, id `<source kind>:<externalId>` (`kuma:3`, `probe:api`): a Kuma monitor, a probe or a service a webhook declares. It has a kind (`http`, `port`, `ping`, `keyword`, `push`, `fact`), a status (`up`, `down`, `degraded`, `pending`, `maintenance`, `paused`, `unknown`), latency, uptime ratios, an optional certificate summary and a display target (host and path, never an address).
- **Heartbeat.** One check result of a service: time, status, latency, a short message. Raw heartbeats are kept 26 hours and folded into 5-minute buckets (`heartbeat_5m`, kept 90 days) that feed the 90-day beat bars.
- **Incident.** Derived, never typed in (`src/worker/engine/incidents.ts`). A `down` incident belongs to a service: a `down` beat opens one, `up` or `degraded` closes it; `pending`, `maintenance`, `paused` and `unknown` do neither, so maintenance is never downtime. A `stale` incident belongs to a source: the 5-minute sweep opens it when the source turns `stale` and closes it when the source is `fresh` or `aging` again (an ingest from the silent source closes it at once). Ids are `<subject>:<startedAt>`, so derivation is idempotent.
- **Fact.** A typed value (`number`, `string`, `boolean`, `timestamp`) in a group, with an optional unit and severity (`ok`, `warn`, `crit`, `info`), an observation time and how long it stays current (`freshForS`). Facts carry the state that is not a heartbeat: replication lag, the last backup, disk use. Samples are kept 90 days (`fact_samples`).

Every string the model stores is **display-safe**: the schemas reject address literals, emails and token-like strings in display fields (`src/shared/model/safety.ts`), and producers map addresses to host names before they send.

## From model to page

`buildSiteView` (`src/shared/view/build.ts`) is the one pure function from stored data to what a theme renders: the site model, 90 days of `heartbeat_5m` cells, the site config and `now` go in, a `SiteView` comes out. No I/O, no clock reads, deterministic.

- A service whose source is `stale` or `empty` shows as `stale`, never with its last status, so stale data never keeps a green dot.
- The **verdict** is, in order of precedence: `empty` (nothing has reported), `outage` (a service is down on current data), `stale` (a source is stale), `degraded`, `operational`. Stale services never count as down, so stale data cannot fake an outage.
- Each service gets a health score from the config's weights (uptime, latency, certificate), 90 daily beat cells, recent checks and a sparkline; facts are grouped, labelled and levelled against the config's thresholds; the topology, activity feed and incidents are laid out for rendering.

`GET /api/sites/:site/view` returns this view; the page's SSR loader fetches it through the API bridge and hands it to the site's theme. The page refreshes its data every 30 seconds while the tab is visible and ticks ages every second.

## Themes and the kit

A theme is one React page over `SiteView`. Three are registered (`src/client/themes/index.ts`): `a-sys-status`, `b-control-room` and `c-session`. The site config picks one; `/?theme=<id>` previews another without saving. Themes import only the component kit (`@/client/kit`), the effect hooks (`@/client/effects`) and the view types, and style through semantic tokens, so switching a theme never touches data code. All themes share the command palette (`/` or Ctrl/Cmd+K) and the keyboard map (`?`). The contract and the kit are documented in [THEMES.md](THEMES.md).

## Site config and revisions

A site's config (`SiteConfig`, `src/shared/config/site.ts`) holds its name, hostnames, theme, sources and their expected intervals, probes, sections (which services appear under which title), display names, host aliases, an optional topology (nodes and replication, watches, depends or network edges), health weights, fact thresholds, links, branding, the public allow-list and notification switches.

```mermaid
flowchart LR
  seed["sites/slug.json<br/>(seed, version 1)"] --> d1[("D1 site_configs<br/>one row per revision")]
  admin["/admin editor<br/>form or raw JSON"] -->|"save: new revision"| d1
  restore["Revisions: restore"] -->|"saved again as a new revision"| d1
  d1 --> kv[("KV config:site")]
  kv --> mem["isolate memory<br/>15 s"]
  mem --> pages["pages, API, crons"]
```

- The committed `sites/<slug>.json` seeds version 1 of a site on first read. From then on D1 is the source of truth: every save is a new row, nothing is overwritten or deleted, and a restore saves an old version again as a new revision.
- Saves use optimistic concurrency (`baseVersion`): a save against a stale version answers 409.
- Reads go isolate memory (15 s), then KV, then D1, so a save shows everywhere within about 15 seconds.
- Export produces `sites/<slug>.json` byte for byte (keys in schema order, defaults applied), and import takes the same format with a dry run that shows the diff.

## Admin

`/admin` has five tabs: **Config** (form or raw JSON, validated, with a diff before saving), **Revisions** (history with restore), **Import and export**, **Sources** (ingest sources and their keys) and **Themes** (side-by-side previews). The admin API is typed in `src/shared/schemas/admin.ts` and mounted at `/api/admin`:

| Route | What it does |
| --- | --- |
| `GET`, `PUT /sites/:site/config` | read the current config, save a new revision |
| `GET /sites/:site/config/export`, `POST .../import` | export, import (with a dry run) |
| `GET .../revisions`, `POST .../revisions/:version/restore` | list revisions, restore one |
| `GET`, `POST /sites/:site/sources` | list sources and keys, add a source with a new key |
| `POST /sites/:site/sources/:keyId/rotate` | issue a new secret for a key |
| `POST /notify/test?kind=stale\|recovered` | send a test notification card |

Ingest keys created in admin are stored in D1 sealed with AES-256-GCM under a key derived (HKDF-SHA256) from the `SOURCE_MASTER_KEY` secret; a secret is shown exactly once. Rotation keeps the old secret working until the producer's first request signed with the new one, which promotes it:

```mermaid
sequenceDiagram
  participant A as Admin
  participant W as Worker
  participant P as Producer
  A->>W: rotate key (POST .../sources/:keyId/rotate)
  W-->>A: new secret, shown once (stored sealed as "next")
  A->>P: install the new secret
  P->>W: ingest signed with the new secret
  W->>W: verified with "next": promote it, drop the old one
  P--xW: a request with the old secret is now rejected
```

Keys can also come from Worker secrets named `INGEST_KEY_<ID>` (bound to a site and source in `src/worker/ingest/keys.ts`); the first rotation of such a key moves it into D1.

## Notifications

When `DISCORD_WEBHOOK_URL` is set, the notifier (`src/worker/notify`) posts exactly one Discord card when a `stale` incident opens (a source went silent) and one when it resolves (it is back, with how many heartbeats were backfilled for the gap). Service `down` incidents do not post: the monitor that watches the service (Uptime Kuma, for example) already alerts on those.

- Both places that see stale transitions hand them to the notifier: the 5-minute sweep and an ingest that brings a silent source back.
- Each transition is claimed in the D1 `notifications` table before its card is sent, so it goes out at most once, however often a cron retries.
- Cards never ping anyone, carry only source ids, host names and times, and are checked for addresses, emails and tokens before sending. A send times out after 5 seconds; a 429 is retried once. Failures are recorded, never thrown into the cron or the ingest.
- `POST /api/admin/notify/test` sends a card labelled TEST built from the current state.

## Crons

The `scheduled` handler (`src/worker/scheduled.ts`) picks the job by the trigger's cron expression, so the triggers in `wrangler.jsonc` and the constants in `src/worker/cron.ts` must match exactly.

| Trigger | Job |
| --- | --- |
| `* * * * *` | Edge probes: every probe due this minute runs (at most 6 at a time), results go through the ingest path as source `probe:cf` |
| `*/5 * * * *` | Fold the last 2 hours of heartbeats into `heartbeat_5m`; sync configured sources; sweep source staleness, open and close `stale` incidents, post their cards, refresh `latest:<site>` when anything changed |
| `17 3 * * *` | Prune rows past retention (see [SECURITY.md](SECURITY.md#data-retention)) |

Probes check public `https` URLs only (no address literals, credentials or private-only names), never follow redirects, never read the body, and retry a failure once after 2 seconds before counting it as `down`.

## Security gates

Every request passes the same steps in `src/server.ts`: rate limits, the admin gate, the viewer gate, then Hono or TanStack Start, and every response leaves with the security headers.

- **Viewer gate.** With `VIEWER_KEY` set, pages and the read API answer 404 without a signed `uptellis_view` or `uptellis_admin` cookie. Opening any page with `?key=<VIEWER_KEY>` sets the cookie and redirects to the same URL without the key.
- **Admin gate.** `/admin` and `/api/admin/*` need the `uptellis_admin` cookie, set by `?admin=<ADMIN_KEY>`; admin writes must be same-origin.
- **Always open.** `GET /api/health` and the signed ingest routes.
- **Rate limits** on ingest, gate attempts and admin writes; a 256 KB body cap before any hashing; CSP and the usual headers on everything.

The full model, with the cookie construction, the ingest checks, the limits and the headers, is in [SECURITY.md](SECURITY.md).

## Source layout

| Path | What lives there |
| --- | --- |
| `src/server.ts` | the Worker entry: limits, gates, dispatch, headers, `scheduled` |
| `src/worker/` | Hono app, ingest, adapters, engine (store, incidents, configs, keys), probes, notify, crons, middleware, D1 schema |
| `src/shared/` | model, config, payload schemas, signing, the pure view builder |
| `src/client/` | routes, themes, the kit, effects, the shell (command palette, key map), the admin UI |
| `collector/` | the Kuma collector (Bun), its Dockerfile and compose file |
| `profiles/` | producers for specific systems (see [profiles/forgejo-ha](../profiles/forgejo-ha/README.md)) |
| `sites/` | committed site configs (the seed of version 1) |
| `migrations/` | D1 migrations |
| `tests/` | Vitest projects `unit`, `integration` (Hono in workerd with a migrated D1) and `ssr` (the built Worker), and the fixtures |
