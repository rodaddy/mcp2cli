# mcp2cli

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/rodaddy)

CLI bridge that wraps MCP (Model Context Protocol) servers as bash-invokable commands. Instead of loading all MCP tool definitions into an LLM's system prompt (~13K+ tokens permanently), agents invoke tools via bash at zero context cost.

## Quick Start

```bash
# Install
git clone <repo-url>
cd mcp2cli
bun install
bun run build        # produces dist/mcp2cli

# Bootstrap from existing Claude config
mcp2cli bootstrap    # reads ~/.claude.json mcpServers -> ~/.config/mcp2cli/services.json

# Use it
mcp2cli services                                    # list available services
mcp2cli n8n --help                                   # list tools for a service
mcp2cli n8n n8n_list_workflows --params '{}'         # invoke a tool
mcp2cli schema n8n.n8n_list_workflows                # inspect tool schema
```

For development without building:

```bash
bun run dev -- services
bun run dev -- n8n n8n_list_workflows --params '{}'
```

## Installation

**Prerequisites:** [Bun](https://bun.sh) v1.0+

```bash
git clone <repo-url>
cd mcp2cli
bun install
bun run build
```

The compiled binary lands at `dist/mcp2cli`. Add it to your PATH or symlink it.

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

If you already have MCP servers configured in `~/.claude.json`:

```bash
mcp2cli bootstrap
```

This reads your `mcpServers` entries and generates `services.json` automatically.

## Commands

### List Services

```bash
mcp2cli services
```

### List Tools for a Service

```bash
mcp2cli <service> --help
```

### Invoke a Tool

```bash
mcp2cli <service> <tool> --params '<json>'
```

The `--params` value must be valid JSON matching the tool's input schema.

### Inspect Tool Schema

```bash
mcp2cli schema <service>.<tool>
```

Returns the JSON Schema for the tool's input parameters -- useful for discovering required fields.

### Dry Run

```bash
mcp2cli <service> <tool> --params '{"query": "test"}' --dry-run
```

Validates input and shows what would be sent without executing the tool call.

### Field Filtering

```bash
mcp2cli <service> <tool> --params '{}' --fields "id,name,status"
```

Extracts only the specified fields from the response -- reduces output noise for scripting.

### Generate Skill Files

```bash
mcp2cli generate-skills <service>
```

Generates PAI skill files from MCP tool schemas, making tools discoverable by AI agents.

### Daemon Management

```bash
mcp2cli daemon status    # check if daemon is running, connection pool stats
mcp2cli daemon stop      # graceful shutdown
```

## Output Format

All responses are structured JSON on stdout. Logs go to stderr.

```json
// Success
{ "success": true, "result": { "workflows": [...] } }

// Error
{ "error": true, "code": "TOOL_ERROR", "message": "Workflow not found", "reason": "..." }
```

This makes mcp2cli composable with `jq`, pipes, and scripting:

```bash
# Get workflow names
mcp2cli n8n n8n_list_workflows --params '{}' | jq '.result.workflows[].name'

# Check for errors
mcp2cli n8n n8n_get_workflow --params '{"id": "123"}' | jq 'if .error then .message else .result end'
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Validation error (bad input, schema mismatch) |
| 2 | Auth error (missing credentials, permission denied) |
| 3 | Tool error (MCP tool returned an error) |
| 4 | Connection error (daemon unreachable, transport failure) |
| 5 | Internal error |

Use exit codes for scripting:

```bash
mcp2cli n8n n8n_get_workflow --params '{"id": "123"}' 2>/dev/null
if [ $? -eq 4 ]; then
  echo "Connection failed -- is the MCP server configured?"
fi
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP2CLI_LOG_LEVEL` | `silent` | Log verbosity: `silent`, `error`, `warn`, `info`, `debug` |
| `MCP2CLI_IDLE_TIMEOUT` | `60` | Daemon idle timeout in seconds |
| `MCP2CLI_TOOL_TIMEOUT` | `30000` | Tool call timeout in milliseconds |
| `MCP2CLI_POOL_MAX` | `50` | Max concurrent MCP connections in the pool |
| `MCP2CLI_LOG_DIR` | `~/.cache/mcp2cli/logs` | Directory for stderr capture logs |
| `MCP2CLI_NO_DAEMON` | (unset) | If set, bypass the daemon and connect directly |
| `MCP2CLI_DEBUG` | (unset) | If `1`, print discarded stdout lines from MCP servers |

Example:

```bash
MCP2CLI_LOG_LEVEL=debug mcp2cli n8n n8n_list_workflows --params '{}'
MCP2CLI_NO_DAEMON=1 mcp2cli n8n n8n_list_workflows --params '{}'
```

## Architecture

```
CLI Entry (src/cli/index.ts)
  |-- Command Dispatch (services, schema, bootstrap, generate-skills, daemon)
  |-- Tool Call Handler -> Daemon Client (Unix socket)
  |                          \-- Daemon Server (src/daemon/server.ts)
  |                                |-- Connection Pool (src/daemon/pool.ts)
  |                                |     \-- MCP Transport (src/connection/transport.ts)
  |                                |-- Idle Timer (src/daemon/idle.ts)
  |                                \-- Health Endpoint (/health with memory stats)
  |-- Input Validation (src/validation/) -- 48 adversarial patterns
  |-- Schema Introspection (src/schema/)
  |-- Skill Generation (src/generation/)
  \-- Structured Logger (src/logger/) -- JSON on stderr
```

### Key Design Decisions

**Persistent daemon.** MCP servers have a 2-5 second startup cost per connection. The daemon keeps connections alive in a pool, so subsequent calls return in milliseconds instead of seconds. The daemon auto-exits after the idle timeout (default 60s).

**Connection pool with health checks.** Connections are validated before use and recycled on failure. The pool enforces a max size to prevent resource exhaustion.

**Structured JSON everywhere.** stdout is always parseable JSON -- no mixed text output. Logs (when enabled) go to stderr as structured JSON lines. This makes mcp2cli reliable for scripting and piping.

**Semantic exit codes.** Different failure modes get different exit codes so callers can branch on the type of error without parsing output.

**Input validation.** All tool parameters are validated against the MCP schema before the call is dispatched. The validation layer handles 48 adversarial patterns (injection attempts, type coercion, overflow) to fail fast with clear errors.

## Agent Integration

mcp2cli is designed to be called from AI agents via bash tool use. A typical agent workflow:

```bash
# Agent discovers available tools
mcp2cli n8n --help

# Agent reads the schema to understand parameters
mcp2cli schema n8n.n8n_get_workflow

# Agent invokes the tool
mcp2cli n8n n8n_get_workflow --params '{"id": "abc123"}'
```

This pattern keeps MCP tool definitions out of the agent's system prompt entirely. The agent only pays context cost when it actually needs to call a tool, and even then only for the specific tool's schema -- not all tools from all servers.

## v1.3 Advanced Features

### Schema Caching

Schemas are cached locally to avoid re-fetching on every invocation. Cached schemas live at `~/.cache/mcp2cli/schemas/` with a 24-hour TTL. Cache drift is detected via SHA-256 hashing -- if the upstream schema changes, the cache is automatically invalidated.

```bash
# Check cache status (age, TTL, drift)
mcp2cli cache status

# Clear all cached schemas
mcp2cli cache clear

# Clear cache for a specific service
mcp2cli cache clear n8n

# Bypass cache for a single schema lookup
mcp2cli schema n8n.n8n_list_workflows --fresh
```

Override the cache directory with `MCP2CLI_CACHE_DIR`.

### Access Control

Restrict which tools are exposed per service using `allowTools` and `blockTools` in `services.json`. Both accept glob patterns.

```json
{
  "services": {
    "n8n": {
      "description": "n8n workflow automation",
      "backend": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic/n8n-mcp"],
      "allowTools": ["n8n_list_*", "n8n_get_*"],
      "blockTools": ["n8n_delete_*"]
    }
  }
}
```

When both are present, `allowTools` is evaluated first (whitelist), then `blockTools` removes matches from the allowed set.

#### Cross-Service Tool Search

Search for tools across all services using cached schemas:

```bash
# Find all tools matching a pattern
mcp2cli grep "workflow"

# Regex patterns work
mcp2cli grep "delete|remove"
```

This searches cached schemas only -- no MCP connections are made.

### WebSocket Transport

Connect to MCP servers over WebSocket. Supports optional stdio fallback and access control, same as HTTP.

```json
{
  "services": {
    "remote-mcp": {
      "description": "Remote MCP server via WebSocket",
      "backend": "websocket",
      "url": "ws://mcp-gateway.local:3000/mcp",
      "fallback": {
        "command": "npx",
        "args": ["-y", "@anthropic/n8n-mcp"]
      }
    }
  }
}
```

WebSocket services benefit from the same circuit breaker and fallback behavior as HTTP services.

### Batch Tool Calls

Execute multiple tool calls in a single invocation by piping NDJSON to `mcp2cli batch`. Each line is a JSON object with `service`, `tool`, and `params` fields:

```bash
# Sequential execution (default)
cat <<EOF | mcp2cli batch
{"service": "n8n", "tool": "n8n_list_workflows", "params": {}}
{"service": "n8n", "tool": "n8n_get_workflow", "params": {"id": "1"}}
EOF

# Parallel execution
cat <<EOF | mcp2cli batch --parallel
{"service": "n8n", "tool": "n8n_list_workflows", "params": {}}
{"service": "n8n", "tool": "n8n_get_workflow", "params": {"id": "1"}}
EOF
```

Output is NDJSON -- one result per line with the original service/tool for correlation:

```json
{"service":"n8n","tool":"n8n_list_workflows","success":true,"result":{...}}
{"service":"n8n","tool":"n8n_get_workflow","success":true,"result":{...}}
```

Errors for individual calls are reported inline without aborting the batch.

### Gateway Resilience

HTTP/SSE services can define a `fallback` stdio config. If the remote gateway is unreachable, mcp2cli transparently falls back to a local MCP server process.

```json
{
  "services": {
    "n8n": {
      "description": "n8n via HTTP gateway with stdio fallback",
      "backend": "http",
      "url": "http://mcp-gateway:3000/n8n",
      "fallback": {
        "command": "npx",
        "args": ["-y", "@anthropic/n8n-mcp"]
      }
    }
  }
}
```

A circuit breaker protects against repeated failures: after 5 consecutive failures the circuit opens and routes directly to fallback for 60 seconds before re-probing the primary. Circuit state is persisted to `~/.cache/mcp2cli/circuit-breaker/` so it survives process restarts.

### Output Formats

Control output format with the `--format` flag:

```bash
mcp2cli n8n n8n_list_workflows --params '{}' --format table
mcp2cli n8n n8n_list_workflows --params '{}' --format yaml
mcp2cli n8n n8n_list_workflows --params '{}' --format csv
mcp2cli n8n n8n_list_workflows --params '{}' --format ndjson
```

| Format | Description |
|--------|-------------|
| `json` | Default. Structured JSON (unchanged from v1.0) |
| `table` | Aligned columns -- human-readable terminal output |
| `yaml` | YAML output |
| `csv` | RFC 4180 CSV -- pipe to spreadsheets or `csvtool` |
| `ndjson` | One JSON object per line -- for streaming pipelines |

Error responses are always JSON regardless of the `--format` flag.

### Skill Auto-Regeneration

Generated skill files can be previewed and kept in sync with upstream schema changes:

```bash
# Preview what would change without writing
mcp2cli generate-skills --diff n8n

# Regenerate (preserves manual sections)
mcp2cli generate-skills n8n
```

Manual edits inside `MANUAL:START` / `MANUAL:END` markers are preserved across regeneration. When schema drift is detected (via the caching layer), skill regeneration can be triggered automatically.

## v1.3 Environment Variables

In addition to the variables listed above, v1.3 adds:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP2CLI_CACHE_DIR` | `~/.cache/mcp2cli` | Base directory for schema cache and circuit breaker state |

## Network Deployment

mcp2cli can run as a centralized TCP daemon, allowing multiple machines to share a single set of MCP server connections. Install and configure MCP backends once on a server, then connect from any machine using the CLI client or the bash wrapper (curl + jq only -- no Bun required).

### Quick Start (TCP Mode)

**Server** -- start the daemon with TCP binding:

```bash
export MCP2CLI_LISTEN_HOST=0.0.0.0
export MCP2CLI_LISTEN_PORT=9500
export MCP2CLI_AUTH_TOKEN=$(openssl rand -hex 32)
MCP2CLI_DAEMON=1 mcp2cli
```

**Client** -- point any machine at the remote daemon:

```bash
export MCP2CLI_REMOTE_URL=http://mcp-server.local:9500
export MCP2CLI_AUTH_TOKEN=<same-token-as-server>
mcp2cli n8n n8n_list_workflows --params '{}'
```

When `MCP2CLI_REMOTE_URL` is set, the CLI skips local daemon startup entirely and sends requests directly over HTTP.

### Network Environment Variables

In addition to the [base environment variables](#environment-variables), network mode adds:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP2CLI_LISTEN_HOST` | (unset) | Bind address for TCP mode. Setting this enables TCP instead of Unix socket. Use `0.0.0.0` to listen on all interfaces |
| `MCP2CLI_LISTEN_PORT` | `9500` | TCP port when `MCP2CLI_LISTEN_HOST` is set |
| `MCP2CLI_AUTH_TOKEN` | (unset) | Bearer token for TCP authentication. Required for production deployments |
| `MCP2CLI_REMOTE_URL` | (unset) | URL of remote mcp2cli daemon (e.g. `http://mcp-server:9500`). Enables remote client mode |
| `MCP2CLI_CONFIG` | `~/.config/mcp2cli/services.json` | Path to service definitions (useful for server-side config in `/etc/mcp2cli/`) |

### Authentication

When `MCP2CLI_AUTH_TOKEN` is set on the server, all requests must include a `Bearer` token in the `Authorization` header. The token comparison uses timing-safe equality to prevent timing attacks.

**Auth-exempt paths** -- these skip authentication so load balancers and monitoring can probe without credentials:
- `GET /health` -- health check with uptime, memory, and pool status
- `GET /metrics` -- Prometheus metrics endpoint

### Prometheus Metrics

The daemon exposes metrics at `GET /metrics` in Prometheus text exposition format. Key metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `mcp2cli_requests_total` | counter | Total requests by `{service, tool}` |
| `mcp2cli_requests_errors_total` | counter | Failed requests by `{service, tool}` |
| `mcp2cli_request_duration_ms` | histogram | Request latency with buckets (10ms - 30s) |
| `mcp2cli_requests_active` | gauge | Currently in-flight requests |
| `mcp2cli_pool_connections_active` | gauge | Current connection pool size |
| `mcp2cli_pool_services` | gauge | Connected services (`{service}` label) |
| `mcp2cli_connection_events_total` | counter | Connect/disconnect/health-check-failure by `{service}` |
| `mcp2cli_auth_failures_total` | counter | Total authentication failures |
| `mcp2cli_process_uptime_seconds` | gauge | Daemon uptime |
| `mcp2cli_process_memory_rss_bytes` | gauge | Resident set size |

Add to your Prometheus config:

```yaml
scrape_configs:
  - job_name: mcp2cli
    static_configs:
      - targets: ['mcp-server.local:9500']
```

### Bash Wrapper (curl-only clients)

For machines that only have `curl` and `jq` (no Bun runtime), use the bash wrapper:

```bash
# Install the wrapper
cp scripts/mcp2cli-remote /usr/local/bin/
chmod +x /usr/local/bin/mcp2cli-remote

# Configure
export MCP2CLI_REMOTE_URL=http://mcp-server.local:9500
export MCP2CLI_AUTH_TOKEN=<token>

# Use it like the full CLI
mcp2cli-remote n8n n8n_list_workflows '{}'
```

### LXC Deployment

The `deploy/` directory contains everything needed to run mcp2cli as a systemd service in an LXC container (or any Linux host):

| File | Purpose |
|------|---------|
| `deploy/mcp2cli.service` | systemd unit file (hardened with `NoNewPrivileges`, `ProtectSystem=strict`) |
| `deploy/env.example` | Environment file template -- copy to `/etc/mcp2cli/env` |
| `deploy/services-server.json` | Example server-side service config |

Setup:

```bash
# Copy files into place
cp deploy/mcp2cli.service /etc/systemd/system/
mkdir -p /etc/mcp2cli
cp deploy/env.example /etc/mcp2cli/env
cp deploy/services-server.json /etc/mcp2cli/services.json

# Edit config
vim /etc/mcp2cli/env           # set MCP2CLI_AUTH_TOKEN
vim /etc/mcp2cli/services.json  # configure your MCP backends

# Enable and start
useradd --system --no-create-home mcp2cli
systemctl daemon-reload
systemctl enable --now mcp2cli
```

### curl Examples

```bash
SERVER=http://mcp-server.local:9500
TOKEN=your-token-here

# Health check (no auth required)
curl -s $SERVER/health | jq .

# Prometheus metrics (no auth required)
curl -s $SERVER/metrics

# List tools for a service
curl -s -X POST $SERVER/list-tools \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"service": "n8n"}' | jq .

# Invoke a tool
curl -s -X POST $SERVER/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"service": "n8n", "tool": "n8n_list_workflows", "params": {}}' | jq .

# Get a tool schema
curl -s -X POST $SERVER/schema \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"service": "n8n", "tool": "n8n_list_workflows"}' | jq .
```

## Development

```bash
bun run dev -- <args>     # run without building
bun test                  # run test suite
bun run build             # compile to dist/mcp2cli
```

## License

MIT
