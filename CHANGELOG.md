# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-06-09

### Added
- Per-service `source` field for remote/local routing control ("local", "remote", "remote-local")
- Remote daemon support with 3x retry and exponential backoff (500ms/1s/2s)
- 4-event request lifecycle logging: request_in → mcp_call_start → mcp_call_end → response_out
- Connection pool preconnect at startup (MCP2CLI_PRECONNECT=1)
- Version in /health endpoint and dynamic version in /metrics from package.json
- Stderr log rotation for MCP server processes (10MB max, single backup)

## [0.3.0] - 2026-06-09

### Added
- Downloadable service skill bundles with hash verification and path traversal protection (#25)
- Health endpoint reports configured vs connected services (#24)
- Structured audit logging for all MCP tool calls (#23)
- Cross-service tool search with JSON output (#22)
- Schema caching, drift detection, and auto-regen wiring (#21)
- Auto-resolve service-prefixed tool names (#16)
- Per-service timeout support in services.json (#15)
- Web Management UI with RBAC Auth (#13)
- HTTP/SSE transport for remote MCP servers (#1)

### Fixed
- Allow tabs, newlines, and carriage returns in MCP tool parameters
- Env var expansion in args and local daemon auth
- Clean up stale socket/pid on daemon startup

### Infrastructure
- CI and Claude Code Review workflows (#3)
- ggshield cache added to gitignore (#14)

## [0.2.0] - 2026-03-09

### Added
- Structured logger with configurable verbosity (LOG-01)
- Request/response tracing for tool invocations (LOG-02)
- Connection lifecycle event logging (LOG-03)
- Daemon stderr capture to log files (LOG-04)
- Memory stats in /health endpoint (LOG-05)
- Reader cleanup on transport close (MEM-01)
- Tool call timeout with AbortSignal (MEM-02)
- Fire-and-forget task cancellation (MEM-03)
- Connection pool size limits (MEM-04)
- Health checks before connection reuse (MEM-05)
- Production README (DOC-01)

## [0.1.0] - 2026-03-09

### Added
- CLI bridge for invoking MCP tools via bash
- Service registry configuration (services.json)
- Input validation with 48 adversarial test patterns
- MCP stdio transport with stdout noise filtering
- Tool invocation with structured JSON output
- Schema introspection at every level (root, service, tool)
- Persistent daemon with PID tracking and idle timeout
- Dry-run mode for mutation preview
- Field masking for response filtering
- Bootstrap migration from ~/.claude.json
- Skill file generation from MCP tool schemas
