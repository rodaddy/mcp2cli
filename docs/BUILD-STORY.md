# How mcp2cli was built

This is the build history of mcp2cli, taken from its git log (66 commits from
2026-03-09 to 2026-10-27, before this file was added), its CHANGELOG, and the issues and pull requests on
the author's self-hosted Forgejo instance, where the project has lived since
September 2026. Dates are commit or PR dates.

## The problem and the first version

Coding agents such as Claude Code load the full tool list of every registered
MCP server into the model's context on every turn. With several servers
registered, most of that context is tool definitions the agent never calls.
The first version, released on 2026-03-09 as v0.2.0, moved those tools behind a
shell command: `mcp2cli <service> <tool> --params '{...}'`, with
`mcp2cli schema` to read one tool's input schema only when it is needed.

The CHANGELOG records what v0.1.0 and v0.2.0 already contained on that first
day: a `services.json` registry, input validation, stdio transport with
stdout noise filtering, schema introspection, a persistent daemon with an idle
timeout, dry-run mode, field masking, import from `~/.claude.json`, and skill
file generation from MCP tool schemas. v0.2.0 added the hardening items
numbered LOG-01..05 and MEM-01..05: structured logging, request tracing, tool
call timeouts, pool size limits and health checks before connection reuse.

## Timeline

| Dates | Phase | What landed |
| --- | --- | --- |
| 2026-03-09 to 03-10 | Transports and a web UI | HTTP/SSE transport (PR #1), WebSocket transport and a batch command (#12), a web management UI with role-based access (#13). CI and an automated Claude code-review workflow (#3). |
| 2026-03-30 to 06-08 | Schema handling | Per-service timeouts (#15), auto-resolving service-prefixed tool names (#16), schema caching with drift detection and auto-regeneration (#21), cross-service tool search (#22), structured audit logging (#23), a health endpoint that reports configured vs connected services (#24), downloadable skill bundles (#25). |
| 2026-06-09 to 06-18 | Network daemon | Per-service local/remote routing with retry and preconnect (#26), per-identity credentials with groups and RBAC (#28), caller identity header templating (#32), an automatic patch-version bump on merge (#31), hardened discovery and auth for the shared hub (#41, #51). |
| 2026-06-27 to 08-03 | Correctness fixes from daily use | Slim generated `SKILL.md` as a routing index (#57), schema cache invalidation on upstream contract change (#59), `${secret:...}` resolution fixes for the daemon and stdio env (#62, #66), tool timeouts passed through to the MCP SDK (#64, #70). |
| 2026-09-04 to 09-07 | Move to self-hosted Forgejo, CI repair, container image | Repo and CI moved to Forgejo Actions (#74), two hidden test bugs fixed so CI no longer needed workarounds (#84), a CI check that blocks process-global transport mocks (#88), image build moved into the repo (#92) and then slimmed (#103), a CI check that VERSION and package.json agree (#106). |
| 2026-09-29 to 10-08 | Daemon and audit hardening | Drop a pooled connection when a tool call times out (#109), never store the response of a secret-returning tool in the audit log (#112), `--params -` reads JSON from stdin (#113), affected-test selection on PRs (#116), transport-mock probes split into four CI shards (#119). |
| 2026-10-13 to 10-27 | Public snapshot and cleanup | A scrubbed sync of the current code back to the public GitHub repository, start-up fix when the runtime directory is missing (#125), CI probes run only when the check they probe changes (#129), removal of a retired runtime integration (#131). |

The VERSION file reads 0.3.22. From June onward each merge to `main` bumped the
patch version automatically, which is why the git log shows a
`chore: bump version` commit after most feature commits.

## Key design decisions

- **Bash as the interface.** The command shape follows the Google Workspace
  CLI: one command per tool, JSON on stdout, semantic exit codes. An agent
  that can run a shell command can use any MCP server without the harness
  knowing about MCP.
- **A daemon instead of one process per call.** Spawning an MCP server for each
  call is slow, so a daemon holds a connection pool, exits after an idle
  timeout, and later grew a network mode so several machines share one set of
  server connections and credentials (#26, #28).
- **One owner for backend dispatch (#84).** Four CLI commands each carried an
  identical stdio/HTTP/WebSocket branch. PR #84 moved that dispatch into
  `src/connection/connect.ts` with a substitution seam, so tests replace the
  connector instead of patching the module registry. An unknown backend now
  throws instead of falling through to stdio.
- **Call servers over HTTP instead of bundling them (#103).** The container
  image first bundled MCP servers. That image failed to build five times for
  five different reasons: a silently dropped optional npm dependency, a
  node-gyp build against a Python without distutils, icons hidden by a broad
  `.gitignore` rule, two out-of-memory failures in the image builder, and
  Python virtualenvs whose absolute interpreter links broke when copied. The
  PR concluded that one image satisfying every server's build dependencies
  fails in as many ways as it has servers, and moved each server to its own
  deployment.
- **Redact by tool name, not by value (#112).** Audit logs stored the values
  returned by secret-lookup tools, because key-based sanitising cannot see a
  secret under a neutral key such as `text`. The fix classifies a call as
  sensitive by service and tool name and records only the response length.
  The PR notes that this deliberately over-redacts.

## How AI models and agents were used

- The git history shows Claude Opus as co-author on 29 of the 66 commits,
  from the first release onward. A Claude code-review workflow ran on every
  pull request from 2026-03-09 (#3).
- From September, work was split into small agent lanes, each with a written
  brief and an executable "done-means" check that had to fail before the
  change and pass after it. PR #74 records `forge-origin.sh` and
  `graph-mode-installed.sh` going red then green.
- PRs from October went through an automated review pipeline. PR #112
  records one reviewer's pass and two automated review rounds, each answered with
  a fix and fresh mutation receipts. PR #119 was written by a GPT
  model in an automated review-and-fix pipeline and records a rehearsed
  revert.
- Issue #90 records a lesson from that work: a 10-line runtime preload
  enforced a test rule better than the static check written for it.

## How it is tested

- `bun test`: 1099 pass, 1 skip, 0 fail on 2026-10-27, in 18 test areas under
  `tests/` (cli, daemon, cache, schema, credentials, secrets, resilience,
  integration and others). PR #74 recorded 1081 passing tests on 2026-09-04.
- `tests/fixtures/mock-mcp-server.ts` is a real MCP server used by the
  integration tests and by the terminal screenshot in the README.
- `scripts/done-means/no-connection-module-mocks.ts` fails CI if a test patches
  the module registry for a transport. Its probe runs 104 known-bad cases
  against the check, split across four CI shards since #119.
- CI also checks that VERSION and package.json agree (#106), after an image
  built from tag v0.3.19 reported version 0.3.18 (#102).

## What did not work, and what changed

- **CI propped up by workarounds.** CI ran tests under an extra init process
  and split the suite into separate runs. PR #84 found both hid real bugs. The
  daemon treated an exited but unreaped (zombie) process as alive, because
  `kill(pid, 0)` still succeeds on a zombie; `isPidAlive()` now reads
  `/proc/<pid>/stat`. Five test files patched transport modules globally, and
  `mock.restore()` does not undo that. After the fix the single-process suite
  went from 1076 pass / 8 fail to 1084 pass / 0 fail.
- **The bundled-server image** never built and was dropped (#103, above).
- **Duplicate CI runs.** Every PR commit ran the full suite twice, once for the
  push and once for the pull request (#115). PR #116 limited push builds to
  `main` and runs only affected tests on PRs. `main` still runs everything.
- **A 60-second hard-coded timeout** lost the results of long tool calls that
  the daemon had in fact completed (#68). The resolved per-tool timeout is now
  passed into the MCP SDK (#70).

## Current state

Active, at version 0.3.22. It is the author's daily route from several coding
agents to their MCP servers. Open issues on Forgejo include idle reaping for
the daemon pool (#107), a codesign step for macOS builds (#67), a migration
from Bun to Node 24 (#78), and explicit fail-closed handling for MCP
elicitation (#48).
