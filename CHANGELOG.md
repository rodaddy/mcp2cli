# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
