<p align="center">
  <strong>mcp2cli</strong><br>
  <em>Use any MCP server from your terminal. No SDK required.</em>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#usage-examples">Examples</a> &bull;
  <a href="#network-deployment">Network Mode</a> &bull;
  <a href="#why-mcp2cli">Why?</a> &bull;
  <a href="#architecture">Architecture</a>
</p>

<p align="center">
  <a href="https://github.com/rodaddy/mcp2cli/actions/workflows/ci.yml"><img src="https://github.com/rodaddy/mcp2cli/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f472b6?logo=bun" alt="Bun">
  <img src="https://img.shields.io/badge/MCP-SDK_1.27-blue" alt="MCP SDK">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
  <img src="https://img.shields.io/badge/tests-67-brightgreen" alt="67 tests">
  <a href="https://buymeacoffee.com/rodaddy"><img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-ffdd00?logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee"></a>
</p>

---

**mcp2cli** turns any [Model Context Protocol](https://modelcontextprotocol.io/) server into a regular CLI command. Discover tools, inspect schemas, invoke operations -- all from bash. A persistent daemon with connection pooling makes subsequent calls return in milliseconds instead of the 2-5 second cold-start each MCP connection normally costs.

```bash
# List what's available
mcp2cli services

# See tools for a service
mcp2cli n8n --help

# Call a tool
mcp2cli n8n n8n_list_workflows --params '{}'

# Pipe through jq like any other CLI
mcp2cli n8n n8n_list_workflows --params '{}' | jq '.result.workflows[].name'
```

## Why mcp2cli?

MCP servers are designed for AI assistants, not humans. To call one, you need to: spin up a transport, do the JSON-RPC handshake, discover tools, validate input schemas, handle errors, then tear down the connection. Every. Single. Time.

**The cost is worse for AI agents.** Loading all MCP tool definitions into a system prompt burns **~13K+ tokens permanently** -- even if the agent never calls most of those tools.

mcp2cli solves both problems:

| Problem | Without mcp2cli | With mcp2cli |
|---------|-----------------|--------------|
| Calling an MCP tool | Write SDK code, manage transport lifecycle | `mcp2cli service tool --params '{}'` |
| Agent tool discovery | ~13K tokens in system prompt, always | Schema lookup on demand, zero baseline cost |
| Connection startup | 2-5 seconds per call | Milliseconds (daemon keeps connections alive) |
| Scripting MCP tools | Not practical | Structured JSON stdout + semantic exit codes |
| Multiple MCP servers | Separate SDK setup for each | One config file, unified CLI |

Inspired by [Google Workspace CLI](https://github.com/googleworkspace/cli), which turned Google's sprawling APIs into simple `gam` commands. mcp2cli does the same for the MCP ecosystem.

## Quick Start

```bash
# 1. Install
git clone https://github.com/rodaddy/mcp2cli.git
cd mcp2cli
bun install
bun run build          # produces dist/mcp2cli

# 2. Add dist/mcp2cli to your PATH
sudo ln -s "$(pwd)/dist/mcp2cli" /usr/local/bin/mcp2cli

# 3. Bootstrap config from your existing Claude Desktop MCP servers
mcp2cli bootstrap      # reads ~/.claude.json -> ~/.config/mcp2cli/services.json

# 4. Go
mcp2cli services
```

**Prerequisites:** [Bun](https://bun.sh) v1.0+

For development without building:

```bash
bun run dev -- services
bun run dev -- n8n n8n_list_workflows --params '{}'
```

## Usage Examples

### 1. List configured services

```bash
$ mcp2cli services
┌─────────────────┬──────────────────────────────────┬─────────┐
│ Service         │ Description                      │ Backend │
├─────────────────┼──────────────────────────────────┼─────────┤
│ n8n             │ n8n workflow automation           │ stdio   │
│ homekit         │ HomeKit smart home control        │ stdio   │
│ vaultwarden     │ Credential management            │ stdio   │
│ open-brain      │ Knowledge base                   │ http    │
└─────────────────┴──────────────────────────────────┴─────────┘
```

### 2. Discover tools for a service

```bash
$ mcp2cli n8n --help
Available tools for n8n:
  n8n_list_workflows      List all workflows
  n8n_get_workflow         Get workflow by ID
  n8n_create_workflow      Create a new workflow
  n8n_update_workflow      Update an existing workflow
  n8n_delete_workflow      Delete a workflow
  n8n_execute_workflow     Execute a workflow
  ...
```

### 3. Inspect a tool's parameter schema

```bash
$ mcp2cli schema n8n.n8n_get_workflow
{
  "name": "n8n_get_workflow",
  "description": "Get workflow by ID",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "description": "Workflow ID" }
    },
    "required": ["id"]
  }
}
```

### 4. Invoke a tool

```bash
$ mcp2cli n8n n8n_get_workflow --params '{"id": "abc123"}'
{
  "success": true,
  "result": {
    "id": "abc123",
    "name": "Daily Report Pipeline",
    "active": true,
    "nodes": [...]
  }
}
```

### 5. Filter output fields

```bash
# Only get the fields you care about
$ mcp2cli n8n n8n_list_workflows --params '{}' --fields "id,name,active"
```

### 6. Alternative output formats

```bash
# Human-readable table
$ mcp2cli n8n n8n_list_workflows --params '{}' --format table

# YAML
$ mcp2cli n8n n8n_list_workflows --params '{}' --format yaml

# CSV for spreadsheets
$ mcp2cli n8n n8n_list_workflows --params '{}' --format csv

# NDJSON for streaming pipelines
$ mcp2cli n8n n8n_list_workflows --params '{}' --format ndjson
```

### 7. Dry run (validate without executing)

```bash
$ mcp2cli n8n n8n_create_workflow --params '{"name": "test"}' --dry-run
# Validates input against schema, shows what would be sent -- no side effects
```

### 8. Batch multiple calls

```bash
# Sequential
cat <<EOF | mcp2cli batch
{"service": "n8n", "tool": "n8n_list_workflows", "params": {}}
{"service": "homekit", "tool": "list_accessories", "params": {}}
EOF

# Parallel (faster, when calls are independent)
cat <<EOF | mcp2cli batch --parallel
{"service": "n8n", "tool": "n8n_list_workflows", "params": {}}
{"service": "homekit", "tool": "list_accessories", "params": {}}
EOF
```

Output is NDJSON -- one result per line for easy parsing.

### 9. Search tools across all services

```bash
# Find any tool related to "workflow" across all configured services
$ mcp2cli grep "workflow"

# Regex patterns work
$ mcp2cli grep "delete|remove"
```

Searches cached schemas only -- no MCP connections made.

### 10. Scripting with exit codes

```bash
#!/usr/bin/env bash
result=$(mcp2cli n8n n8n_get_workflow --params '{"id": "123"}' 2>/dev/null)
case $? in
  0) echo "Workflow: $(echo "$result" | jq -r '.result.name')" ;;
  1) echo "Bad input -- check your params" ;;
  2) echo "Auth error -- check API key" ;;
  3) echo "Tool error -- $(echo "$result" | jq -r '.message')" ;;
  4) echo "Connection failed -- is the MCP server running?" ;;
  5) echo "Internal error" ;;
esac
```

### 11. Use from AI agents

```bash
# Agent discovers tools at runtime -- zero context cost until needed
mcp2cli n8n --help                                         # what tools exist?
mcp2cli schema n8n.n8n_get_workflow                        # what params does it need?
mcp2cli n8n n8n_get_workflow --params '{"id": "abc123"}'   # call it

# Machine-readable help for agent consumption
mcp2cli n8n --help-format=ai                               # JSON output for LLMs
```

### 12. Home automation from the terminal

```bash
# List all HomeKit accessories
mcp2cli homekit list_accessories --params '{}'

# Turn on the living room lights
mcp2cli homekit set_characteristic --params '{"aid": 1, "value": true}'

# Get camera snapshot
mcp2cli homekit get_snapshot --params '{"camera": "front_door"}' | jq -r '.result.image' | base64 -d > snapshot.jpg
```

### 13. Pipe MCP tools together

```bash
# Get all active workflows, extract IDs, fetch details for each
mcp2cli n8n n8n_list_workflows --params '{}' \
  | jq -r '.result.workflows[] | select(.active) | .id' \
  | while read id; do
      mcp2cli n8n n8n_get_workflow --params "{\"id\": \"$id\"}"
    done
```

## Configuration

### Service Registry

mcp2cli discovers MCP servers from `~/.config/mcp2cli/services.json`:

```json
{
  "services": {
    "n8n": {
      "description": "n8n workflow automation",
      "backend": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic-ai/n8n-mcp"],
      "env": {
        "N8N_BASE_URL": "https://n8n.example.com",
        "N8N_API_KEY": "your-api-key"
      }
    },
    "homekit": {
      "description": "HomeKit smart home control",
      "backend": "stdio",
      "command": "node",
      "args": ["/path/to/homekit-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

Each service entry mirrors the Claude Desktop `mcpServers` format -- same `command`, `args`, and `env` fields.

### Bootstrap from Claude Config

Already have MCP servers in `~/.claude.json`? One command:

```bash
mcp2cli bootstrap
```

Reads your `mcpServers` entries and generates `services.json` automatically.

### Access Control

Restrict which tools are exposed per service using `allowTools` and `blockTools` (glob patterns):

```json
{
  "services": {
    "n8n": {
      "description": "n8n workflow automation",
      "backend": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic-ai/n8n-mcp"],
      "allowTools": ["n8n_list_*", "n8n_get_*"],
      "blockTools": ["n8n_delete_*"]
    }
  }
}
```

When both are present, `allowTools` is evaluated first (whitelist), then `blockTools` removes matches.

### Per-Service Timeouts

```json
{
  "services": {
    "slow-service": {
      "description": "Service with long-running operations",
      "backend": "stdio",
      "command": "node",
      "args": ["slow-server.js"],
      "timeout": 120000
    }
  }
}
```

## Transport Backends

mcp2cli supports three transport types:

### stdio (default)

Spawns the MCP server as a child process. Works with any MCP server.

```json
{ "backend": "stdio", "command": "npx", "args": ["-y", "@some/mcp-server"] }
```

### HTTP/SSE

Connects to a remote MCP server over HTTP with optional stdio fallback:

```json
{
  "backend": "http",
  "url": "http://mcp-gateway:3000/n8n",
  "fallback": {
    "command": "npx",
    "args": ["-y", "@anthropic-ai/n8n-mcp"]
  }
}
```

### WebSocket

For persistent connections to remote MCP servers:

```json
{
  "backend": "websocket",
  "url": "ws://mcp-gateway.local:3000/mcp",
  "fallback": {
    "command": "npx",
    "args": ["-y", "@some/mcp-server"]
  }
}
```

All remote transports benefit from the circuit breaker: after 5 consecutive failures, traffic routes to the fallback for 60 seconds before re-probing the primary. Circuit state persists to `~/.cache/mcp2cli/circuit-breaker/`.

## Schema Caching

Schemas are cached locally at `~/.cache/mcp2cli/schemas/` with a 24-hour TTL. Drift detection via SHA-256 hashing automatically invalidates stale entries.

```bash
mcp2cli cache status                                # check age, TTL, drift
mcp2cli cache clear                                 # clear all
mcp2cli cache clear n8n                             # clear one service
mcp2cli schema n8n.n8n_list_workflows --fresh       # bypass cache once
```

## Daemon

The daemon keeps MCP connections alive in a pool so you don't pay the 2-5 second startup cost on every call. It starts automatically on first use and exits after the idle timeout (default 60 seconds).

```bash
mcp2cli daemon status    # running? pool stats, memory usage
mcp2cli daemon stop      # graceful shutdown
```

To bypass the daemon for a single call:

```bash
MCP2CLI_NO_DAEMON=1 mcp2cli n8n n8n_list_workflows --params '{}'
```

## Network Deployment

Run mcp2cli as a centralized TCP daemon. Install MCP backends once on a server, connect from any machine.

### Server

```bash
export MCP2CLI_LISTEN_HOST=0.0.0.0
export MCP2CLI_LISTEN_PORT=9500
export MCP2CLI_AUTH_TOKEN=$(openssl rand -hex 32)
MCP2CLI_DAEMON=1 mcp2cli
```

### Client

```bash
export MCP2CLI_REMOTE_URL=http://mcp-server.local:9500
export MCP2CLI_AUTH_TOKEN=<same-token>
mcp2cli n8n n8n_list_workflows --params '{}'
```

When `MCP2CLI_REMOTE_URL` is set, the CLI skips local daemon startup and sends requests over HTTP.

### Bash Wrapper (curl-only clients)

For machines without Bun -- just `curl` and `jq`:

```bash
cp scripts/mcp2cli-remote /usr/local/bin/
chmod +x /usr/local/bin/mcp2cli-remote

export MCP2CLI_REMOTE_URL=http://mcp-server.local:9500
export MCP2CLI_AUTH_TOKEN=<token>

mcp2cli-remote n8n n8n_list_workflows '{}'
```

### Authentication & RBAC

Token-based auth with three roles:

| Role | Permissions |
|------|------------|
| `viewer` | `list`, `status` |
| `agent` | `list`, `status`, `call`, `list-tools`, `schema` |
| `admin` | Everything including `add`, `remove`, `reload`, `shutdown` |

Auth-exempt endpoints (for monitoring):
- `GET /health` -- uptime, memory, pool status
- `GET /metrics` -- Prometheus metrics

### Web Management UI

The daemon includes an embedded web dashboard at the root URL (`http://mcp-server:9500/`). View service status, connection pool health, and manage services -- all from a browser. No build step, no dependencies.

### Prometheus Metrics

```yaml
# prometheus.yml
scrape_configs:
  - job_name: mcp2cli
    static_configs:
      - targets: ['mcp-server.local:9500']
```

Key metrics exposed at `GET /metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `mcp2cli_requests_total` | counter | Total requests by `{service, tool}` |
| `mcp2cli_requests_errors_total` | counter | Failed requests by `{service, tool}` |
| `mcp2cli_request_duration_ms` | histogram | Latency with buckets (10ms -- 30s) |
| `mcp2cli_requests_active` | gauge | In-flight requests |
| `mcp2cli_pool_connections_active` | gauge | Connection pool size |
| `mcp2cli_auth_failures_total` | counter | Authentication failures |
| `mcp2cli_process_uptime_seconds` | gauge | Daemon uptime |
| `mcp2cli_process_memory_rss_bytes` | gauge | Resident set size |

### curl API

```bash
SERVER=http://mcp-server.local:9500
TOKEN=your-token

# Health check (no auth)
curl -s $SERVER/health | jq .

# List tools
curl -s -X POST $SERVER/list-tools \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"service": "n8n"}' | jq .

# Call a tool
curl -s -X POST $SERVER/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"service": "n8n", "tool": "n8n_list_workflows", "params": {}}' | jq .
```

### LXC / systemd Deployment

The `deploy/` directory has everything for production deployment:

```bash
# Automated setup
sudo ./deploy/setup.sh [path-to-binary]

# Or manual
cp deploy/mcp2cli.service /etc/systemd/system/
mkdir -p /etc/mcp2cli
cp deploy/env.example /etc/mcp2cli/env       # set MCP2CLI_AUTH_TOKEN
cp deploy/services-server.json /etc/mcp2cli/services.json
systemctl enable --now mcp2cli
```

The systemd unit is hardened with `NoNewPrivileges`, `ProtectSystem=strict`, and runs as a dedicated `mcp2cli` system user.

## Skill Generation

Auto-generate AI agent skill files from MCP tool schemas:

```bash
mcp2cli generate-skills n8n                   # generate skill files
mcp2cli generate-skills --diff n8n            # preview changes without writing
```

Manual edits inside `MANUAL:START` / `MANUAL:END` markers are preserved across regeneration. See `examples/skills/` for generated output.

## Output Format

All responses are structured JSON on stdout. Logs go to stderr.

```json
{ "success": true, "result": { "workflows": [...] } }
{ "error": true, "code": "TOOL_ERROR", "message": "Workflow not found" }
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Validation error (bad input, schema mismatch) |
| 2 | Auth error (missing credentials, permission denied) |
| 3 | Tool error (MCP tool returned an error) |
| 4 | Connection error (daemon unreachable, transport failure) |
| 5 | Internal error |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP2CLI_LOG_LEVEL` | `silent` | `silent`, `error`, `warn`, `info`, `debug` |
| `MCP2CLI_IDLE_TIMEOUT` | `60` | Daemon idle timeout (seconds) |
| `MCP2CLI_TOOL_TIMEOUT` | `30000` | Tool call timeout (milliseconds) |
| `MCP2CLI_POOL_MAX` | `50` | Max concurrent MCP connections |
| `MCP2CLI_LOG_DIR` | `~/.cache/mcp2cli/logs` | stderr capture log directory |
| `MCP2CLI_NO_DAEMON` | (unset) | Bypass daemon, connect directly |
| `MCP2CLI_DEBUG` | (unset) | Print discarded stdout from MCP servers |
| `MCP2CLI_CACHE_DIR` | `~/.cache/mcp2cli` | Schema cache and circuit breaker state |
| `MCP2CLI_LISTEN_HOST` | (unset) | TCP bind address (enables network mode) |
| `MCP2CLI_LISTEN_PORT` | `9500` | TCP port for network mode |
| `MCP2CLI_AUTH_TOKEN` | (unset) | Bearer token for TCP auth |
| `MCP2CLI_REMOTE_URL` | (unset) | Remote daemon URL (enables client mode) |
| `MCP2CLI_CONFIG` | `~/.config/mcp2cli/services.json` | Service definitions path |

## Architecture

```
CLI (src/cli/)
  ├── Command Dispatch ── services | schema | bootstrap | generate-skills | cache | grep | batch
  ├── Tool Call ──────── Daemon Client (Unix socket or TCP)
  │                        └── Daemon Server (src/daemon/server.ts)
  │                              ├── Connection Pool (src/daemon/pool.ts)
  │                              │     └── Transport: stdio | HTTP/SSE | WebSocket
  │                              ├── Circuit Breaker (src/resilience/)
  │                              ├── RBAC Auth (src/daemon/auth-provider.ts)
  │                              ├── Prometheus Metrics (src/daemon/metrics.ts)
  │                              ├── Web UI (src/daemon/ui.ts)
  │                              └── Idle Timer (src/daemon/idle.ts)
  ├── Input Validation ── 48 adversarial patterns (src/validation/)
  ├── Schema Cache ────── SHA-256 drift detection, 24h TTL (src/cache/)
  ├── Output Formats ──── JSON | table | YAML | CSV | NDJSON (src/format/)
  ├── Skill Generation ── auto-regen with manual section preservation (src/generation/)
  └── Structured Logger ─ JSON on stderr (src/logger/)
```

### Key Design Decisions

- **Persistent daemon** -- MCP connections have a 2-5s startup cost. The daemon pools them. Auto-exits after idle timeout.
- **Structured JSON everywhere** -- stdout is always parseable. Logs go to stderr. Reliable for scripting and piping.
- **Semantic exit codes** -- Different failure modes get different codes so callers can branch without parsing output.
- **Input validation** -- All parameters validated against MCP schemas before dispatch. 48 adversarial patterns (injection, type coercion, overflow) caught early.
- **Circuit breaker** -- Remote transports fail gracefully with automatic fallback to local stdio servers.
- **Zero-dependency web UI** -- Single-file HTML dashboard, no build step.

## Development

```bash
bun run dev -- <args>     # run without building
bun test                  # 67 tests across 17 test suites
bun run build             # compile to dist/mcp2cli
bun run typecheck         # TypeScript type checking
```

## Comparison with Alternatives

| Approach | Context Cost | Latency | Scriptable | Multi-Server |
|----------|-------------|---------|------------|-------------|
| MCP in system prompt | ~13K tokens/session | Fast (in-process) | No | Yes |
| Raw MCP SDK | 0 (custom code) | 2-5s cold start | Manual | Manual |
| **mcp2cli** | **0 baseline** | **~ms (pooled)** | **Yes (JSON + exit codes)** | **Yes (one config)** |

## License

MIT

