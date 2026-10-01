#!/usr/bin/env bash
# Smoke test of the Docker image: builds it (unless IMAGE is given), runs it on a fresh volume and checks
# the first request, /api/health, a page and a static asset, first-run setup of the owner account, a
# scheduler tick, the health check, the non-root user and labels, and that a config saved (signed in)
# before a container replacement is still there after. It runs the bundled demo site (SITE_DEFAULT=demo; the
# image itself sets no default, so a real install starts with no site).
#
#   bun run docker:smoke                     # build uptellis:smoke from this checkout, then test it
#   IMAGE=ghcr.io/bts-io/uptellis:x bun run docker:smoke    # test an existing image
#   PLATFORM=linux/arm64 bun run docker:smoke                # build and run another platform (emulated)
set -euo pipefail

cd "$(dirname "$0")/.."
NAME="uptellis-smoke-$$"
VOLUME="$NAME-data"
# Test-only, random per run; the same for both containers so the session survives the replacement.
AUTH_SECRET="$(openssl rand -base64 32)"
OWNER_EMAIL="$(printf '%s@%s' smoke-owner example.com)"
PLATFORM_ARGS=()
[ -n "${PLATFORM:-}" ] && PLATFORM_ARGS=(--platform "$PLATFORM")

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  docker logs "$NAME" 2>&1 | tail -40 >&2 || true
  exit 1
}

if [ -z "${IMAGE:-}" ]; then
  IMAGE="uptellis:smoke"
  VERSION="$(bun -p "require('./package.json').version")"
  echo "building $IMAGE (version $VERSION)"
  docker build -q "${PLATFORM_ARGS[@]}" -t "$IMAGE" --build-arg VERSION="$VERSION" . >/dev/null
fi

run() {
  docker run -d "${PLATFORM_ARGS[@]}" --name "$NAME" -p 3000 -v "$VOLUME:/data" \
    -e BETTER_AUTH_SECRET="$AUTH_SECRET" -e SITE_DEFAULT=demo "$IMAGE" >/dev/null
  PORT="$(docker port "$NAME" 3000/tcp | head -1 | sed 's/.*://')"
  BASE="http://localhost:$PORT"
  for _ in $(seq 1 60); do
    curl -fsS "$BASE/api/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  fail "no answer on /api/health"
}

echo "image: user, labels"
[ "$(docker image inspect -f '{{.Config.User}}' "$IMAGE")" = "bun" ] || fail "image does not run as the bun user"
[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.source"}}' "$IMAGE")" = \
  "https://github.com/bts-io/uptellis" ] || fail "source label"

echo "first start"
run
curl -fsS "$BASE/api/health" | grep -q '"ok":true' || fail "health body"
PAGE="$(curl -fsS "$BASE/" | tr -d '\0')"
grep -q "<title>" <<<"$PAGE" || fail "page did not render"
ASSET="$(grep -o '/assets/[A-Za-z0-9_.-]*\.css' <<<"$PAGE" | head -1)"
[ -n "$ASSET" ] || fail "page links no stylesheet"
[ "$(curl -fsS -o /dev/null -w '%{http_code}' "$BASE$ASSET")" = "200" ] || fail "asset $ASSET"
[ "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/sites/nope/view")" = "404" ] || fail "unknown site"

echo "first-run setup, then admin save (persists across containers)"
[ "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/admin/sites/demo/config")" = "401" ] || fail "admin open"
SETUP="$(curl -fsS -D - -o /dev/null -X POST -H "content-type: application/json" -H "origin: $BASE" \
  --data "{\"name\":\"Smoke\",\"email\":\"$OWNER_EMAIL\",\"password\":\"smoke-owner-password\"}" \
  "$BASE/api/setup")" || fail "setup"
COOKIE="$(grep -ioE '^set-cookie: (__Secure-)?uptellis.session_token=[^;]*' <<<"$SETUP" | sed 's/^[^:]*: //' || true)"
[ -n "$COOKIE" ] || fail "setup set no session cookie"
CONFIG="$(curl -fsS -H "cookie: $COOKIE" "$BASE/api/admin/sites/demo/config")"
BODY="$(bun -e '
  const s = JSON.parse(process.argv[1]);
  console.log(JSON.stringify({ baseVersion: s.version, config: { ...s.config, name: "Acme Cloud Smoke" } }));
' "$CONFIG")"
curl -fsS -X PUT -H "content-type: application/json" -H "sec-fetch-site: same-origin" -H "cookie: $COOKIE" \
  --data "$BODY" "$BASE/api/admin/sites/demo/config" | grep -q '"version"' || fail "config save"

echo "scheduler tick (up to 70 s)"
for _ in $(seq 1 70); do
  docker logs "$NAME" 2>&1 | grep -q '"evt":"cron","job":"probes"' && break
  sleep 1
done
docker logs "$NAME" 2>&1 | grep -q '"evt":"cron","job":"probes"' || fail "no probes run logged"

echo "health check"
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = "healthy" ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = "healthy" ] || fail "container not healthy"

echo "graceful stop, new container on the same volume"
docker stop -t 20 "$NAME" >/dev/null
docker logs "$NAME" 2>&1 | grep -q '"step":"stopped"' || fail "no graceful stop logged"
[ "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" = "0" ] || fail "non-zero exit on SIGTERM"
docker rm "$NAME" >/dev/null
run
curl -fsS -H "cookie: $COOKIE" "$BASE/api/admin/sites/demo/config" | grep -q '"name":"Acme Cloud Smoke"' ||
  fail "config or session lost on restart"

echo "OK: $IMAGE"
