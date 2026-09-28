# Uptellis agent. Build from the repo root (the image needs src/shared and src/checks):
#   docker build -f agent/Dockerfile -t uptellis-agent --build-arg VERSION=$(bun -p "require('./package.json').version") .
# Multi-arch: docker buildx build --platform linux/amd64,linux/arm64 -f agent/Dockerfile ...
ARG BUN_VERSION=1.3.14

# The output is one bundled JavaScript file, so it is built once on the build machine's own platform.
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app
COPY agent/package.json agent/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY agent/package.json ./agent/package.json
COPY agent/src ./agent/src
ARG VERSION=""
RUN if [ -n "$VERSION" ]; then define="--define AGENT_VERSION=\"${VERSION#v}\""; else define=""; fi && \
    bun build agent/src/main.ts --target bun --outfile /out/agent.js $define

FROM oven/bun:${BUN_VERSION}-alpine
ARG VERSION=dev
LABEL org.opencontainers.image.title="Uptellis agent" \
      org.opencontainers.image.description="Runs Uptellis monitors inside a private network" \
      org.opencontainers.image.source="https://github.com/bts-io/uptellis" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
# iputils ping for ping monitors. As the non-root user it opens an unprivileged ICMP socket, which needs
# net.ipv4.ping_group_range to cover the user (compose.yaml sets it; Docker does by default since 20.10).
# Without that sysctl, ping needs CAP_NET_RAW (README, "Ping").
RUN apk add --no-cache iputils && \
    install -d -o bun -g bun -m 700 /data
WORKDIR /app
COPY --from=build /out/agent.js /app/agent.js
# /data holds the result buffer and the last monitor list (a volume); /tmp (a tmpfs in compose) the
# liveness file.
ENV NODE_ENV=production \
    UPTELLIS_DATA_DIR=/data \
    UPTELLIS_LIVENESS_FILE=/tmp/agent-alive
VOLUME /data
USER bun
# Healthy while the scheduler ticked in the last 3 minutes (it ticks every minute, online or not).
HEALTHCHECK --interval=60s --timeout=5s --start-period=90s \
  CMD test -n "$(find /tmp/agent-alive -mmin -3 2>/dev/null)" || exit 1
STOPSIGNAL SIGTERM
ENTRYPOINT ["bun", "/app/agent.js"]
