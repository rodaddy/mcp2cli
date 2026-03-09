# mcp2cli

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
      "backend": "stdio",
      "command": "npx",
      "args": ["-y", "@anthropic-ai/n8n-mcp"],
      "env": {
        "N8N_BASE_URL": "https://n8n.example.com",
        "N8N_API_KEY": "your-api-key"
      }
    },
    "homekit": {
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

## Development

```bash
bun run dev -- <args>     # run without building
bun test                  # run test suite
bun run build             # compile to dist/mcp2cli
```

## License

MIT
