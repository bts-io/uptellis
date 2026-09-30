# Uptellis collector

A small Bun + TypeScript service that runs next to Uptime Kuma 2.5.5 (on `watch-1` in the demo site). It
keeps one socket.io session to Kuma, mirrors what Kuma pushes into memory, and every 60 s POSTs a signed
`KumaSnapshot` (`src/shared/schemas/ingest.ts`) to the Worker's `/api/ingest/kuma`.

```
src/main.ts        CLI: run forever, --once, --dry-run, --record PATH
src/session.ts     one Kuma session: password login once, loginByToken on reconnect, backoff, liveness probe
src/state.ts       state store and reducers for the Kuma events below
src/snapshot.ts    buildSnapshot(state, now, opts) and guardSnapshot (fail closed)
src/address.ts     HOST_ALIASES mapping, scrubbing, forbidden-literal field paths
src/buffer.ts      unsent heartbeats: 60-minute ring, per-monitor ack watermark
src/collector.ts   the tick: refresh, build, guard, sign and send (or print)
src/sender.ts      signed POST with Access service-token headers
src/config.ts      environment and secret files
src/shared.ts      the only import path into ../src/shared (schema, literal detector, HMAC v1 signer)
```

## Run

```sh
cd collector
bun install
bun test                       # unit tests + a fake Kuma (socket.io server) end to end
bun run typecheck
KUMA_PASSWORD_FILE=... bun run dry-run          # one snapshot on stdout, nothing sent
KUMA_PASSWORD_FILE=... bun run record           # writes ../tests/fixtures/data/kuma-recorded.json
bun src/main.ts --once                          # one signed POST, exit code 0 when acknowledged
bun src/main.ts                                 # forever
```

Logs are JSON lines on stderr with counts, ids, field paths and status codes only: never a payload,
password, token or Kuma message.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `KUMA_URL` | `http://localhost:3001` | Kuma bound to localhost on the same host, hence host networking |
| `KUMA_USERNAME` | `admin` | |
| `KUMA_PASSWORD_FILE` | required | or `KUMA_PASSWORD` for local runs; file must be mode 600 or 400 |
| `COLLECTOR_HOST` | `watch-1` | `host` in the snapshot |
| `HOST_ALIASES` / `HOST_ALIASES_FILE` | none | JSON object, address -> host name, e.g. tailnet address -> `app-1` |
| `INGEST_URL` | required to send | full URL, https, e.g. `https://status.example.com/api/ingest/kuma`; the signed path is its pathname |
| `KEY_ID` | required to send | e.g. `collector-1` (`X-Uptellis-Key-Id`) |
| `INGEST_KEY_FILE` | required to send | HMAC secret, mode 600; the key is the file's UTF-8 text, trimmed |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET_FILE` | none | Access service token `status-collector-1`; both or neither |
| `INTERVAL_S` | `60` | |
| `BUFFER_WINDOW_MIN` | `60` | how long unsent heartbeats are kept while the Worker is unreachable |
| `LIVENESS_FILE` | `/tmp/collector-alive` | touched every tick; the image healthcheck reads it; empty disables |
| `LOG_LEVEL` | | `debug` for debug lines |

## Behaviour

- **Session.** One socket.io connection (websocket; Kuma's origin check allows clients without an Origin).
  The password is used for one `login` (Kuma's `loginRateLimiter` allows 20 per minute for the whole
  instance); the returned JWT is kept in memory and used with `loginByToken` on every reconnect. A rejected
  token falls back to one password login. Failed logins back off 30 s doubling to 15 min with jitter.
  Transport reconnects use socket.io's backoff (1 s to 60 s, jitter 0.5); a server-side disconnect is
  retried after 5 s. `getDatabaseSize` runs each tick and doubles as the liveness probe: three failures in a
  row force a reconnect. The collector only ever emits `login`, `loginByToken`, `getMonitorList`,
  `getDatabaseSize` and `monitorImportantHeartbeatListPaged` (`ALLOWED_EMITS`, asserted in tests).
- **Snapshot.** Monitor config is whitelisted field by field (Kuma's `monitorList` carries auth headers,
  passwords and connection strings; none of it is kept). Kuma's placeholder `url` (`https://`) on non-HTTP
  monitors becomes null, URL credentials are dropped, `method` is only kept for HTTP-like types, Kuma's
  `timeout` 0 becomes null.
- **Addresses.** Names, URLs, hostnames, heartbeat messages, cert names and the error text pass through
  `HOST_ALIASES` (known address -> host name, `[v6]` in URLs too) and then `scrubForbiddenLiterals`. Before
  a snapshot leaves the process, `guardSnapshot` walks every string and runs the shared Zod schema; any
  finding means the snapshot is not sent and `snapshot.refused` is logged with field paths only.
- **Heartbeats.** Every beat Kuma reports goes into `BeatBuffer`. A snapshot carries the oldest pending
  beats (at most 2000, body kept under 240 KB); a 2xx answer removes exactly those and moves the
  per-monitor watermark, so the 100 beats Kuma resends on every login are not sent twice. While the Worker
  is unreachable the buffer keeps 60 minutes; retries back off 5 s doubling up to the interval, with jitter.
  Important beats (last 20 per monitor, fetched each tick) are always sent; the Worker is idempotent on them.
- **Kuma down.** The snapshot is still sent, with `reachable: false`, an `error` and the last known monitor
  config, so the page can say "Kuma down" rather than "collector down".

## Kuma events (confirmed in the 2.5.5 source, `server/server.js`, `server/client.js`, `server/model/monitor.js`, `server/socket-handlers/database-socket-handler.js`)

| Event | Direction | Payload |
|---|---|---|
| `info` | push on connect (no version) and after login | `{ primaryBaseURL, serverTimezone, serverTimezoneOffset, version, latestVersion, isContainer, dbType, runtime }` |
| `login` | emit, ack | `{ username, password, token }` -> `{ ok, token }`, `{ tokenRequired }` or `{ ok: false, msg }` |
| `loginByToken` | emit, ack | `token` -> `{ ok }` or `{ ok: false, msg: "authInvalidToken" }` |
| `monitorList` | push after login | object keyed by id, `Monitor.toJSON(preload, includeSensitiveData=true)` |
| `updateMonitorIntoList` / `deleteMonitorFromList` | push | same shape (subset) / monitor id |
| `heartbeatList` | push after login | `(monitorID, rows, overwrite)`: last 100 raw SQL rows, oldest first, snake case (`monitor_id`) |
| `heartbeat` | push live | `Heartbeat.toJSON()`: `{ monitorID, status, time, msg, ping, important, duration, retries, response }` |
| `avgPing` | push (`Monitor.sendStats`) | `(monitorID, ms or null)`, 24 h |
| `uptime` | push | `(monitorID, 24 or 720 or "1y", ratio)` |
| `certInfo` | push | `(monitorID, info_json)`: JSON string `{ valid, certInfo }`, certInfo has `subject.CN`, `issuer.CN/O`, `validTo`, `daysRemaining` |
| `domainInfo` | push | `(monitorID, daysRemaining, expiry)`; not used |
| `monitorImportantHeartbeatListPaged` | emit, ack | `(monitorID, offset, count)` -> `{ ok, data }`, newest first; not pushed on login in 2.5.5 |
| `getDatabaseSize` | emit, ack | -> `{ ok, size }` (bytes; 0 on MariaDB) |

Beat `time` is stored as UTC `YYYY-MM-DD HH:mm:ss.SSS`; the collector sends ISO 8601 with `Z`.

## Image and deploy

The image is built from the repo root (it needs `src/shared`) and holds one bundled file:

```sh
docker build -f collector/Dockerfile -t uptellis-collector .
```

`compose.yaml` runs it with `network_mode: host`, `read_only`, a 1 MB tmpfs on `/tmp`, `cap_drop: ALL`,
`no-new-privileges`, user 1000, `restart: unless-stopped`, log rotation and a healthcheck. On the Kuma host
(files outside git, owned by uid 1000 because compose file secrets are bind mounts, mode 600):

```
/etc/uptellis/collector.env              from collector.env.example (HOST_ALIASES, INGEST_URL, KEY_ID, CF_ACCESS_CLIENT_ID)
/etc/uptellis/kuma_password              Kuma admin password
/etc/uptellis/ingest_key                 the secret admin issued for KEY_ID (Sources tab)
/etc/uptellis/cf_access_client_secret    Access service token status-collector-1 secret
```

```sh
install -d -m 700 -o 1000 -g 1000 /etc/uptellis
docker compose -f collector/compose.yaml up -d --build
docker logs -f uptellis-collector
```

## Recorder

`--record PATH` waits for the login burst, fetches important beats and the database size, builds one
guarded snapshot (the last 60 minutes of beats) and writes it. The committed fixture
`tests/fixtures/data/kuma-recorded.json` is synthetic, in the same format, generated for the demo site by
`bun tests/fixtures/generate-kuma.ts`; `bun run record` overwrites it with a recording of your own Kuma,
which then belongs in your fork only.
