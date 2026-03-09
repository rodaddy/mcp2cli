# Contributing to mcp2cli

Thanks for your interest in contributing.

## Development Setup

```bash
git clone https://github.com/yourusername/mcp2cli.git
cd mcp2cli
bun install
bun test
```

## Requirements

- [Bun](https://bun.sh/) v1.0+
- TypeScript 5+

## Workflow

1. Fork the repo and create a branch from `main`
2. Write tests for any new functionality
3. Run `bun test` and `npx tsc --noEmit` before submitting
4. Keep PRs focused -- one feature or fix per PR

## Code Style

- TypeScript strict mode
- Functional patterns preferred over classes (exceptions: Transport, ConnectionPool)
- All output to stdout must be structured JSON
- Logs go to stderr via the structured logger (`src/logger/`)
- Files should stay under 750 lines

## Testing

```bash
bun test                    # run all tests
bun test tests/logger/      # run specific module tests
bun test --watch            # watch mode
```

Tests use Bun's built-in test runner. Mock MCP servers are in `tests/fixtures/`.

## Architecture

See the [README](README.md) for architecture overview. Key modules:

| Directory | Responsibility |
|-----------|---------------|
| `src/cli/` | CLI entry point, command dispatch |
| `src/config/` | Service registry config loading |
| `src/connection/` | MCP transport (stdio), client connection |
| `src/daemon/` | Persistent daemon, connection pool, idle timer |
| `src/invocation/` | Tool call handling, dry-run, field masking |
| `src/schema/` | Schema introspection, formatting |
| `src/generation/` | Skill file generation |
| `src/validation/` | Input security validation |
| `src/logger/` | Structured JSON logger |

## Reporting Issues

Open a GitHub issue with:
- What you expected
- What happened
- Steps to reproduce
- `mcp2cli --version` output
