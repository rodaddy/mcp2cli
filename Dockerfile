# mcp2cli daemon image. Two stages: bun compiles a single binary, then a plain
# Debian runtime runs it as a non-root user with a TCP listener on 9500.
#
# Build:  docker build -t mcp2cli .
# Run:    docker run -p 9500:9500 -e MCP2CLI_DAEMON=1 \
#           -e MCP2CLI_AUTH_TOKEN=<token> \
#           -v $PWD/services.json:/etc/mcp2cli/services.json:ro mcp2cli
#
# =============================== stage 1: build ==============================
FROM docker.io/oven/bun:1 AS build

WORKDIR /opt/build

# Manifests first so a source-only change reuses the install
# layer; .dockerignore keeps dist/, node_modules/ and the local caches out.
COPY package.json bun.lock ./
# --frozen-lockfile: the committed bun.lock is the dependency pin. If it does
# not satisfy package.json the build FAILS rather than silently resolving
# something newer than what was reviewed.
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build \
    && test -x dist/mcp2cli

# ============================== stage 2: runtime =============================
# Plain Debian.
FROM docker.io/library/debian:trixie-slim

# uv/uvx as a copied static binary from the upstream distroless image -- the
# documented install path that needs no curl-pipe-sh and no /tmp.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# ca-certificates  TLS to the HTTP MCP services (all of them, now) and registries
# curl             probes and the health path from inside the container
# jq               the CLI's own output is JSON
# nodejs/npm       npx, for the `stitch` call-time server
# passwd           useradd, for the non-root runtime user below
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         ca-certificates \
         curl \
         jq \
         nodejs \
         npm \
         passwd \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /opt/build/dist/mcp2cli /usr/local/bin/mcp2cli
RUN chmod 755 /usr/local/bin/mcp2cli

# --- Non-root runtime user ---------------------------------------------------
# uid 1000. HOME is the writable state dir: tokens, the schema cache, the uv
# cache and logs all land under it. These ENV lines are the in-image default
# so the binary is runnable standalone; override any of them at run time.
#
# MCP2CLI_DAEMON is deliberately NOT set here. Baking it in makes the binary
# ignore its own argv: `mcp2cli --version` would start a daemon instead of
# printing a version. Set it at run time.
ENV HOME=/var/lib/mcp2cli \
    MCP2CLI_LISTEN_HOST=0.0.0.0 \
    MCP2CLI_LISTEN_PORT=9500 \
    MCP2CLI_CONFIG=/etc/mcp2cli/services.json \
    MCP2CLI_TOKENS_FILE=/var/lib/mcp2cli/tokens.json \
    MCP2CLI_CREDENTIALS_FILE=/etc/mcp2cli-secret/credentials.json \
    MCP2CLI_CACHE_DIR=/var/lib/mcp2cli/schemas \
    MCP2CLI_LOG_DIR=/var/lib/mcp2cli/logs \
    UV_CACHE_DIR=/var/lib/mcp2cli/uv-cache \
    PATH=/usr/local/bin:/usr/bin:/bin

RUN /usr/sbin/useradd -m -u 1000 -d /var/lib/mcp2cli -s /bin/bash mcp2cli \
    && mkdir -p /var/lib/mcp2cli/schemas \
                /var/lib/mcp2cli/logs \
                /var/lib/mcp2cli/uv-cache \
                /etc/mcp2cli \
    && chown -R mcp2cli:mcp2cli /var/lib/mcp2cli /etc/mcp2cli

USER mcp2cli
WORKDIR /var/lib/mcp2cli

# The daemon's TCP listener. /health and /metrics on this port are
# auth-exempt (src/daemon/auth.ts:12); every other route requires
# MCP2CLI_AUTH_TOKEN.
EXPOSE 9500

ENTRYPOINT ["/usr/local/bin/mcp2cli"]
