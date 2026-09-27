# Uptellis Kuma collector. Build from the repo root (the image needs src/shared):
#   docker build -f collector/Dockerfile -t uptellis-collector .
FROM oven/bun:1.3-alpine AS build
WORKDIR /app
COPY collector/package.json collector/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src/shared ./src/shared
COPY collector/src ./collector/src
# One self-contained file: no node_modules and no source in the runtime image.
RUN bun build collector/src/main.ts --target bun --outfile /out/collector.js

FROM oven/bun:1.3-alpine
WORKDIR /app
COPY --from=build /out/collector.js /app/collector.js
# The only writable path is /tmp (a tmpfs in compose), used for the liveness file.
ENV NODE_ENV=production \
    LIVENESS_FILE=/tmp/collector-alive
USER bun
# Healthy while a tick ran in the last 3 minutes (ticks run every 60 s, sent or not).
HEALTHCHECK --interval=60s --timeout=5s --start-period=90s \
  CMD test -n "$(find /tmp/collector-alive -mmin -3 2>/dev/null)" || exit 1
ENTRYPOINT ["bun", "/app/collector.js"]
