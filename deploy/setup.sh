#!/usr/bin/env bash
#
# mcp2cli LXC Provisioning Script
# Sets up a dedicated container to run mcp2cli as a network daemon.
#
# Usage:
#   ./setup.sh [path-to-mcp2cli-binary]
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Colors for output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }

# --- 1. Check root ---
if [[ $EUID -ne 0 ]]; then
    err "This script must be run as root"
    exit 1
fi

# --- 2. Create system user/group ---
log "Creating mcp2cli system user and group..."
if ! getent group mcp2cli >/dev/null 2>&1; then
    groupadd --system mcp2cli
fi
if ! getent passwd mcp2cli >/dev/null 2>&1; then
    useradd --system --gid mcp2cli --home-dir /var/lib/mcp2cli --shell /usr/sbin/nologin mcp2cli
fi

# --- 3. Install system dependencies ---
log "Installing system dependencies (curl, jq, unzip)..."
apt-get update -qq
apt-get install -y -qq curl jq unzip ca-certificates gnupg

# --- 4. Install bun ---
if ! command -v bun >/dev/null 2>&1; then
    log "Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    # Make bun available system-wide
    if [[ -f /root/.bun/bin/bun ]]; then
        ln -sf /root/.bun/bin/bun /usr/local/bin/bun
        ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx
    fi
else
    log "bun already installed: $(bun --version)"
fi

# --- 5. Install node/npm ---
if ! command -v node >/dev/null 2>&1; then
    log "Installing Node.js via nodesource..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt-get install -y -qq nodejs
else
    log "Node.js already installed: $(node --version)"
fi

# --- 6. Install uv (for uvx) ---
if ! command -v uv >/dev/null 2>&1; then
    log "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # Make uv/uvx available system-wide
    if [[ -f /root/.local/bin/uv ]]; then
        ln -sf /root/.local/bin/uv /usr/local/bin/uv
        ln -sf /root/.local/bin/uvx /usr/local/bin/uvx
    fi
else
    log "uv already installed: $(uv --version)"
fi

# --- 7. Create directories ---
log "Creating directories..."
mkdir -p /etc/mcp2cli
mkdir -p /var/lib/mcp2cli/cache
mkdir -p /var/log/mcp2cli
chown -R mcp2cli:mcp2cli /var/lib/mcp2cli /var/log/mcp2cli

# --- 8. Install binary ---
if [[ $# -ge 1 && -f "$1" ]]; then
    log "Installing mcp2cli binary from $1..."
    cp "$1" /usr/local/bin/mcp2cli
    chmod +x /usr/local/bin/mcp2cli
else
    warn "No binary provided. Build and copy manually:"
    warn "  bun build src/cli.ts --compile --outfile mcp2cli"
    warn "  cp mcp2cli /usr/local/bin/mcp2cli"
fi

# --- 9. Copy services config ---
log "Installing services config..."
cp "${SCRIPT_DIR}/services-server.json" /etc/mcp2cli/services.json
chown mcp2cli:mcp2cli /etc/mcp2cli/services.json
chmod 640 /etc/mcp2cli/services.json

# --- 10. Copy env template (don't overwrite existing) ---
if [[ ! -f /etc/mcp2cli/env ]]; then
    log "Installing env template..."
    cp "${SCRIPT_DIR}/env.example" /etc/mcp2cli/env
    chown mcp2cli:mcp2cli /etc/mcp2cli/env
    chmod 600 /etc/mcp2cli/env
else
    warn "/etc/mcp2cli/env already exists -- not overwriting"
fi

# --- 11. Install systemd service ---
log "Installing systemd service..."
cp "${SCRIPT_DIR}/mcp2cli.service" /etc/systemd/system/mcp2cli.service
systemctl daemon-reload
systemctl enable mcp2cli.service

# --- 12. Next steps ---
echo ""
log "Setup complete. Next steps:"
echo ""
echo "  1. Edit /etc/mcp2cli/env"
echo "     - Set MCP2CLI_AUTH_TOKEN (use: openssl rand -hex 32)"
echo "     - Store the token in vaultwarden for client config"
echo ""
echo "  2. Edit /etc/mcp2cli/services.json"
echo "     - Update IPs/ports for your environment"
echo "     - Set any required API keys via env var references"
echo ""
if [[ ! -f /usr/local/bin/mcp2cli ]]; then
    echo "  3. Install the mcp2cli binary:"
    echo "     bun build src/cli.ts --compile --outfile mcp2cli"
    echo "     scp mcp2cli root@<container>:/usr/local/bin/"
    echo ""
    echo "  4. Start the service:"
else
    echo "  3. Start the service:"
fi
echo "     systemctl start mcp2cli"
echo "     journalctl -u mcp2cli -f"
echo ""
