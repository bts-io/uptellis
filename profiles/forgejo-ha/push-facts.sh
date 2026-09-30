#!/usr/bin/env bash
# push-facts.sh: push the forgejo-ha facts of this node to Uptellis (POST /api/ingest/facts).
#
# The facts producer of the forgejo-ha profile: a Forgejo failover pair (primary and standby, streaming
# Postgres replication, a fence and an offsite backup). Runs as root on each node from
# uptellis-push-facts.timer every 15 minutes (systemd/ next to this script). It gathers the serving node,
# Forgejo version and public healthz, Postgres role and replication state and lag, the fence decision,
# reason and timelines, last and next backup, runners online, disk, and watchdog reachability. It builds a
# FactsPayload (src/shared/schemas/ingest.ts) and signs it with the Uptellis ingest scheme:
#
#   canonical = "v1\n{keyId}\n{ts}\n{nonce}\nPOST\n{path}\n{sha256hex(body)}"
#   X-Uptellis-Signature = hex(HMAC-SHA256(INGEST_KEY as UTF-8 bytes, canonical))
#   X-Uptellis-Key-Id, X-Uptellis-Timestamp (unix seconds), X-Uptellis-Nonce (32 lower-case hex characters)
#
#   push-facts.sh             gather, sign and POST
#   push-facts.sh --dry-run   gather and sign, print the request (headers, blank line, body); no POST
#
# Config: /etc/uptellis/ingest.env (INGEST_ENV overrides), mode 600, KEY=value lines:
#   INGEST_URL=https://<status host>    KEY_ID=facts-1    INGEST_KEY=<secret>
#   CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=...   (optional, once Cloudflare Access fronts ingest)
# Reads (never writes) the forgejo-ha stack: FORGEJO_HA_STACK (/opt/forgejo-ha/stack/.env), FORGEJO_HA_STATE
# (/var/lib/forgejo-ha), NOTIFY_ENV (/etc/forgejo-ha-backup/notify.env, for FORGEJO_STATUS_TOKEN).
#
# Facts carry host names only: the peer's tailnet address is mapped to its tailnet machine name and any
# address left in free text is replaced before the payload is built. Secrets never reach stdout or logs.
# Test hooks: PUSH_FACTS_BODY (file used as the body instead of gathering), PUSH_FACTS_TS, PUSH_FACTS_NONCE.
set -euo pipefail
umask 077

readonly INGEST_PATH=/api/ingest/facts
log() { echo "push-facts: $*" >&2; }
die() { log "$*"; exit 1; }

dry_run=
for arg in "$@"; do
  case $arg in
    --dry-run) dry_run=1 ;;
    -h | --help) sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $arg (try --help)" ;;
  esac
done

command -v openssl >/dev/null || die "openssl is required"
command -v python3 >/dev/null || die "python3 is required"

# KEY=value from a file without sourcing it (last one wins, surrounding quotes dropped).
env_get() { # env_get <file> <name>
  [ -r "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

ingest_env=${INGEST_ENV:-/etc/uptellis/ingest.env}
[ -r "$ingest_env" ] || die "cannot read $ingest_env"
mode=$(stat -c %a "$ingest_env")
case $mode in
  600 | 400) ;;
  *) [ -n "$dry_run" ] && log "warning: $ingest_env is mode $mode, expected 600" || die "$ingest_env is mode $mode, expected 600" ;;
esac
INGEST_KEY=$(env_get "$ingest_env" INGEST_KEY)
KEY_ID=$(env_get "$ingest_env" KEY_ID)
INGEST_URL=$(env_get "$ingest_env" INGEST_URL)
INGEST_URL=${INGEST_URL%/}
[ -n "$INGEST_KEY" ] || die "INGEST_KEY missing in $ingest_env"
[[ $KEY_ID =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]] || die "KEY_ID missing or malformed in $ingest_env"
if [ -z "$dry_run" ]; then
  [[ $INGEST_URL == https://* ]] || die "INGEST_URL must be an https URL"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# ------------------------------------------------------------------------------------------------------
# Gather (every probe is best effort: a failed probe drops its facts, it never fails the push)
# ------------------------------------------------------------------------------------------------------
gather() {
  local stack_env=${FORGEJO_HA_STACK:-/opt/forgejo-ha/stack}/.env
  local state_dir=${FORGEJO_HA_STATE:-/var/lib/forgejo-ha}
  local notify_env=${NOTIFY_ENV:-/etc/forgejo-ha-backup/notify.env}
  local pg_user pg_db peer_host app_url watchdog_url token
  pg_user=$(env_get "$stack_env" POSTGRES_USER)
  pg_db=$(env_get "$stack_env" POSTGRES_DB)
  peer_host=$(env_get "$stack_env" PEER_HOST)
  app_url=$(env_get "$stack_env" APP_URL)
  watchdog_url=$(env_get "$stack_env" WATCHDOG_URL)

  export F_HOST F_ROLE F_RUNNING F_VERSION F_HEALTHZ F_REPL F_LOCAL_STATE F_PEER_STATE F_PEER_SET \
    F_PEER_OK F_PEER_NAME F_PEER_RAW F_FENCE F_FENCE_REASON F_BACKUP F_NEXT F_DISK F_DISK_H \
    F_WATCHDOG_SET F_WATCHDOG F_RUNNERS F_TAILSCALE
  F_HOST=$(hostname -s 2>/dev/null || hostname)
  F_ROLE=$(env_get "$stack_env" ROLE)
  F_RUNNING=$(docker inspect -f '{{.State.Running}}' forgejo-ha-forgejo 2>/dev/null || true)
  F_VERSION=$(docker exec -u git forgejo-ha-forgejo forgejo --version 2>/dev/null | awk '{print $3}' | cut -d+ -f1 || true)
  F_HEALTHZ=
  [ -n "$app_url" ] && F_HEALTHZ=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "$app_url/api/healthz" || true)

  local sql=(docker exec forgejo-ha-postgres psql -U "${pg_user:-forgejo}" -d "${pg_db:-forgejo}" -Atc)
  local state_sql="select pg_is_in_recovery()::text || ' ' || timeline_id from pg_control_checkpoint()"
  F_REPL=$("${sql[@]}" "select state || '|' || coalesce(extract(epoch from replay_lag)::int::text, '0') from pg_stat_replication limit 1" 2>/dev/null || true)
  F_LOCAL_STATE=$("${sql[@]}" "$state_sql" 2>/dev/null || true)
  F_PEER_SET=${peer_host:+1}
  F_PEER_OK= F_PEER_STATE= F_PEER_RAW=$peer_host
  if [ -n "$peer_host" ]; then
    docker exec forgejo-ha-postgres pg_isready -q -t 5 -h "$peer_host" >/dev/null 2>&1 && F_PEER_OK=yes || F_PEER_OK=no
    if [ "$F_PEER_OK" = yes ]; then
      # The password travels in the environment (docker exec -e NAME), not on a command line.
      F_PEER_STATE=$(PGPASSWORD=$(env_get "$stack_env" POSTGRES_PASSWORD) PGCONNECT_TIMEOUT=5 \
        docker exec -e PGPASSWORD -e PGCONNECT_TIMEOUT forgejo-ha-postgres \
        psql -h "$peer_host" -U "${pg_user:-forgejo}" -d "${pg_db:-forgejo}" -Atc "$state_sql" 2>/dev/null || true)
    fi
  fi
  F_TAILSCALE=$(tailscale status --json 2>/dev/null || true)

  F_FENCE=$(cat "$state_dir/fence.state" 2>/dev/null || true)
  F_FENCE_REASON=$(cat "$state_dir/fence.reason" 2>/dev/null || true)
  F_BACKUP=$(cat "$state_dir/last-backup.json" 2>/dev/null || true)
  F_NEXT=$(systemctl show -p NextElapseUSecRealtime --value forgejo-ha-offsite-backup.timer 2>/dev/null || true)
  if [ -n "$F_NEXT" ] && [ "$F_NEXT" != n/a ]; then F_NEXT=$(date -d "$F_NEXT" +%s 2>/dev/null || true); else F_NEXT=; fi
  F_DISK=$(df -B1 --output=used,size,pcent / 2>/dev/null | tail -1 || true)
  F_DISK_H=$(df -h --output=used,size,pcent / 2>/dev/null | tail -1 | awk '{print $1 " / " $2 " (" $3 ")"}' || true)

  F_WATCHDOG_SET=${watchdog_url:+1}
  F_WATCHDOG=
  [ -n "$watchdog_url" ] && F_WATCHDOG=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' "$watchdog_url" || true)

  token=$(env_get "$notify_env" FORGEJO_STATUS_TOKEN)
  F_RUNNERS=
  if [ -n "$token" ]; then
    # The token goes in on stdin (-H @-), so it never shows on a command line.
    F_RUNNERS=$(printf 'Authorization: token %s\n' "$token" |
      curl -s --max-time 10 -H @- "http://localhost:3000/api/v1/admin/actions/runners" 2>/dev/null || true)
  fi

  F_FRESH_FOR_S=${FRESH_FOR_S:-1800} python3 - <<'PY'
import ipaddress, json, os, re, time

e = os.environ.get
fresh = int(e("F_FRESH_FOR_S", "1800"))
now = int(time.time())
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(t)))

def label(name):
    """A single-label host name as the model wants it (app-1), or None."""
    name = (name or "").strip().lower().split(".")[0]
    name = re.sub(r"[^a-z0-9-]", "-", name).strip("-")[:63]
    return name or None

def is_address(s):
    try:
        ipaddress.ip_address(s.strip("[]"))
        return True
    except ValueError:
        return False

host = label(e("F_HOST")) or "unknown"

# Peer: PEER_HOST is a tailnet address; report the tailnet machine name instead.
peer_raw = (e("F_PEER_RAW") or "").strip()
peer = None
if peer_raw:
    try:
        ts = json.loads(e("F_TAILSCALE") or "{}")
        for p in list((ts.get("Peer") or {}).values()) + [ts.get("Self") or {}]:
            if peer_raw in (p.get("TailscaleIPs") or []) or peer_raw.rstrip(".") == (p.get("DNSName") or "").rstrip("."):
                peer = label(p.get("HostName"))
                break
    except ValueError:
        pass
    if not peer:
        peer = "peer" if is_address(peer_raw) else label(peer_raw)

ADDR = re.compile(r"(?<![\w.:])(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}(?:\d{1,3}(?:\.\d{1,3}){3})?)(?![\w:])")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")

def clean(s, limit=500):
    """Display-safe text: the peer address becomes its name, any other address or email is dropped."""
    s = (s or "").strip()
    if peer_raw:
        s = s.replace(peer_raw, peer or "peer")
    s = ADDR.sub(lambda m: "[address]" if is_address(m.group(0)) else m.group(0), s)
    s = EMAIL.sub("[email]", s)
    s = " ".join(s.split())[:limit]
    return s or None

def as_int(s):
    try:
        return int(str(s).strip())
    except (TypeError, ValueError):
        return None

groups = {}
def fact(group, key, value, *, unit=None, severity=None, type_=None, observed=None):
    if value is None or value == "":
        return
    if isinstance(value, str):
        value = clean(value)
        if value is None:
            return
    f = {"key": key, "value": value, "freshForS": fresh}
    if type_: f["type"] = type_
    if unit: f["unit"] = unit
    if severity: f["severity"] = severity
    groups.setdefault(group, []).append(f)

# forgejo: which node serves, its version, the public healthz
running = e("F_RUNNING") == "true"
local_state = (e("F_LOCAL_STATE") or "").split()
in_recovery = local_state[0] == "true" if len(local_state) >= 1 else None
role = {True: "standby", False: "primary"}.get(in_recovery) or (e("F_ROLE") or "").strip() or None
fence = (e("F_FENCE") or "").strip() or None
serving_node = host if running else (peer if peer and (role == "standby" or fence == "fence") else None)
fact("forgejo", "node", host)
fact("forgejo", "serving", running, severity="ok" if running or role == "standby" else "crit")
fact("forgejo", "servingNode", serving_node or "none", severity=None if serving_node else "crit")
if running:
    fact("forgejo", "version", (e("F_VERSION") or "").strip() or None)
healthz = as_int(e("F_HEALTHZ"))
if healthz is not None:
    fact("forgejo", "healthzCode", healthz, severity="ok" if healthz == 200 else "crit")
    fact("forgejo", "healthzOk", healthz == 200, severity="ok" if healthz == 200 else "crit")

# replication: Postgres role, the standby's streaming state and replay lag, peer reachability
fact("replication", "role", role)
repl = (e("F_REPL") or "").strip()
state, _, lag = repl.partition("|")
if role == "primary":
    fact("replication", "state", state or "none", severity="ok" if state == "streaming" else "warn")
    fact("replication", "standbyConnected", bool(state), severity="ok" if state else "warn")
    if state:
        fact("replication", "lagSeconds", as_int(lag) or 0, unit="s")
if peer:
    fact("replication", "peer", peer)
    ok = e("F_PEER_OK")
    if ok in ("yes", "no"):
        fact("replication", "peerReachable", ok == "yes", severity="ok" if ok == "yes" else "warn")

# fence: decision, reason and both timelines
if fence:
    fact("fence", "decision", fence, severity="ok" if fence == "serve" else "warn")
    fact("fence", "reason", e("F_FENCE_REASON"))
if len(local_state) >= 2:
    fact("fence", "timeline", as_int(local_state[1]))
peer_state = (e("F_PEER_STATE") or "").split()
if len(peer_state) >= 2:
    fact("fence", "peerRole", "standby" if peer_state[0] == "true" else "primary")
    fact("fence", "peerTimeline", as_int(peer_state[1]))

# backup: last run from offsite-backup.sh, next run from its timer
try:
    backup = json.loads(e("F_BACKUP") or "null")
except ValueError:
    backup = None
if isinstance(backup, dict) and as_int(backup.get("time")):
    ok = backup.get("result") == "ok"
    fact("backup", "lastAt", iso(backup["time"]), type_="timestamp")
    fact("backup", "lastResult", "ok" if ok else "failed", severity="ok" if ok else "crit")
    if ok:
        fact("backup", "snapshot", str(backup.get("snapshot") or "") or None)
        fact("backup", "size", str(backup.get("size") or "") or None)
        fact("backup", "durationS", as_int(backup.get("duration")), unit="s")
    else:
        fact("backup", "failedStep", str(backup.get("step") or "?"))
else:
    fact("backup", "lastResult", "none", severity="warn")
nxt = as_int(e("F_NEXT"))
if nxt:
    fact("backup", "nextAt", iso(nxt), type_="timestamp")
else:
    fact("backup", "nextScheduled", False, severity="warn")

# runners: Forgejo Actions runners online (needs FORGEJO_STATUS_TOKEN, read:admin)
raw = e("F_RUNNERS")
if raw:
    try:
        runners = json.loads(raw)
        runners = runners.get("runners", runners) if isinstance(runners, dict) else runners
        if isinstance(runners, list):
            offline = [str(r.get("name", "?")) for r in runners if r.get("status") == "offline"]
            total = len(runners)
            fact("runners", "online", total - len(offline), severity="warn" if offline else "ok")
            fact("runners", "total", total)
            fact("runners", "offline", ", ".join(offline) if offline else "none")
            fact("runners", "list", ", ".join(f"{r.get('name', '?')} {r.get('status', '?')}" for r in runners) or None)
    except ValueError:
        pass

# disk: the root filesystem
d = (e("F_DISK") or "").split()
if len(d) == 3:
    used, size, pct = as_int(d[0]), as_int(d[1]), as_int(d[2].rstrip("%"))
    fact("disk", "usedBytes", used, unit="bytes")
    fact("disk", "sizeBytes", size, unit="bytes")
    if pct is not None:
        fact("disk", "percent", pct, unit="%", severity="crit" if pct >= 90 else "warn" if pct >= 80 else "ok")
fact("disk", "display", e("F_DISK_H"))

# watchdog: the watchdog's status page (Uptime Kuma), only when WATCHDOG_URL is set
if e("F_WATCHDOG_SET"):
    code = e("F_WATCHDOG") or "000"
    up = code[:1] in ("2", "3")
    fact("watchdog", "reachable", up, severity="ok" if up else "warn")
    fact("watchdog", "httpCode", as_int(code) or 0)

order = ["forgejo", "replication", "fence", "backup", "runners", "disk", "watchdog"]
print(json.dumps({
    "v": 1,
    "generatedAt": iso(now),
    "producer": host,
    "groups": [{"group": g, "facts": groups[g]} for g in order if groups.get(g)],
}, separators=(",", ":")))
PY
}

body=$tmp/body.json
if [ -n "${PUSH_FACTS_BODY:-}" ]; then
  cat "$PUSH_FACTS_BODY" >"$body"
else
  json=$(gather) || die "could not build the facts payload"
  printf '%s' "$json" >"$body"
fi

# ------------------------------------------------------------------------------------------------------
# Sign
# ------------------------------------------------------------------------------------------------------
ts=${PUSH_FACTS_TS:-$(date +%s)}
nonce=${PUSH_FACTS_NONCE:-$(openssl rand -hex 16)}
body_hash=$(openssl dgst -sha256 -r "$body" | cut -d' ' -f1)
canonical=$(printf 'v1\n%s\n%s\n%s\nPOST\n%s\n%s' "$KEY_ID" "$ts" "$nonce" "$INGEST_PATH" "$body_hash")
# HMAC in python3, which reads INGEST_KEY from the mode-600 env file itself: the key is never on a command
# line (an openssl HMAC key option would show it in the process list) and never in the environment. The file
# is parsed exactly like env_get (last INGEST_KEY= line wins, one pair of surrounding quotes dropped), so the
# key bytes are the same UTF-8 bytes (surrounding whitespace trimmed) as the secret admin issued for KEY_ID.
signature=$(printf '%s' "$canonical" | python3 -c '
import hashlib, hmac, sys
key = None
with open(sys.argv[1], "rb") as f:
    for line in f.read().split(b"\n"):
        if line.startswith(b"INGEST_KEY="):
            key = line[len(b"INGEST_KEY="):]
if not key:
    sys.exit(1)
for q in (b"\"", b"\x27"):
    if len(key) >= 2 and key[:1] == q and key[-1:] == q:
        key = key[1:-1]
key = key.strip()  # issued secrets have no surrounding whitespace; the collector trims its key file the same way
if not key:
    sys.exit(1)
print(hmac.new(key, sys.stdin.buffer.read(), hashlib.sha256).hexdigest())
' "$ingest_env")
[[ $signature =~ ^[0-9a-f]{64}$ ]] || die "signing failed"

headers=$tmp/headers
{
  echo "Content-Type: application/json"
  echo "X-Uptellis-Key-Id: $KEY_ID"
  echo "X-Uptellis-Timestamp: $ts"
  echo "X-Uptellis-Nonce: $nonce"
  echo "X-Uptellis-Signature: $signature"
} >"$headers"

if [ -n "$dry_run" ]; then
  echo "POST ${INGEST_URL:-<INGEST_URL unset>}$INGEST_PATH"
  cat "$headers"
  echo
  cat "$body"
  echo
  exit 0
fi

# ------------------------------------------------------------------------------------------------------
# Post (Access service token headers, when configured, go through the same mode-600 header file)
# ------------------------------------------------------------------------------------------------------
access_id=$(env_get "$ingest_env" CF_ACCESS_CLIENT_ID)
access_secret=$(env_get "$ingest_env" CF_ACCESS_CLIENT_SECRET)
if [ -n "$access_id" ] && [ -n "$access_secret" ]; then
  echo "CF-Access-Client-Id: $access_id" >>"$headers"
  echo "CF-Access-Client-Secret: $access_secret" >>"$headers"
fi

code=$(curl -sS --max-time 20 -o "$tmp/response" -w '%{http_code}' -X POST -H @"$headers" \
  --data-binary @"$body" "$INGEST_URL$INGEST_PATH") || die "POST failed (network)"
case $code in
  2*) log "accepted ($code, $(wc -c <"$body") bytes)" ;;
  *) die "rejected with HTTP $code: $(head -c 300 "$tmp/response" | tr -d '\n')" ;;
esac
