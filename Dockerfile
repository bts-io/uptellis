# Uptellis for Docker: one Bun process serving the status page, the API and the admin, SQLite in /data,
# and its own scheduler for the probes, the staleness sweep and pruning. Build from the repo root:
#   docker build -t uptellis --build-arg VERSION=$(bun -p "require('./package.json').version") .
# Multi-arch: docker buildx build --platform linux/amd64,linux/arm64 ... (docs/OPERATIONS.md, Docker).
ARG BUN_VERSION=1.3.14

# The build output is plain JavaScript with every dependency bundled in (vite.config.ts, docker mode), so it
# is built once on the build machine's own platform and the runtime image needs no node_modules.
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# The commit /api/health reports (vite.config.ts reads GITHUB_SHA).
ARG GITHUB_SHA=""
RUN bun run build:docker && mkdir -p /out/data

# Only COPY below: nothing runs on the target platform while building, so any platform builds anywhere.
FROM oven/bun:${BUN_VERSION}-alpine
ARG VERSION=dev
ARG GITHUB_SHA=""
LABEL org.opencontainers.image.title="Uptellis" \
      org.opencontainers.image.description="Self-hostable status page and monitor" \
      org.opencontainers.image.source="https://github.com/bts-io/uptellis" \
      org.opencontainers.image.url="https://github.com/bts-io/uptellis" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GITHUB_SHA}"
# iputils ping for ping monitors run by the builtin runner. As the non-root user it opens an unprivileged
# ICMP socket, which needs net.ipv4.ping_group_range to cover the user (compose.yaml sets it). Without that
# sysctl, ping needs CAP_NET_RAW.
RUN apk add --no-cache iputils
WORKDIR /app
COPY migrations ./migrations
COPY src/platform/docker/main.ts ./src/platform/docker/main.ts
COPY --from=build /app/dist-docker ./dist-docker
# The SQLite file (and its WAL) lives in the volume, owned by the unprivileged bun user.
COPY --from=build --chown=bun:bun /out/data /data
VOLUME /data
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/uptellis.db \
    SITE_DEFAULT=demo
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch(`http://localhost:${process.env.PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "src/platform/docker/main.ts"]
