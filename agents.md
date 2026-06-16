# mcp2cli Local Agent Policy

This repo is part of the canonical live Codex workspace under
`/Volumes/ThunderBolt/Development/mcp2cli`.

Future sessions working in this repo must treat this file as the repo-local
router, then apply the global and Development-wide routers:

- Global: `~/.codex/AGENTS.md`
- Development-wide: `/Volumes/ThunderBolt/Development/AGENTS.md`
- Repo-local quick alias: `_AGENTS.md`

If a higher-level policy is stricter, follow the stricter rule. If this file is
more specific to `mcp2cli`, follow this file. On this case-insensitive volume,
opening `AGENTS.md` resolves to this same `agents.md` file.

## Runtime Policy

- This is Codex, not Claude Code. Prefer Codex-native tools, slash commands, and
  Codex config.
- PAI skills are workflow and context docs, not Codex slash commands.
- Use natural language triggers such as "search brain", "session wrap",
  "critical-mode", "add todo", and "check todos".
- Do not load Claude Code hooks, command status lines, marketplaces, or direct
  MCP server blocks.
- Use `/opt/homebrew/bin/bash`, never `/bin/bash`, for shell workflows when a
  bash shell is needed.
- Prefer `bun` for Node/TypeScript, `uv` for Python, and `brew` for macOS
  packages.
- Use `rg` and `rg --files` before slower search tools.

## PAI LAWs For Codex

- Skills first: if a Codex skill matches the task, read and use it instead of
  rebuilding the workflow manually.
- Critical thinking: challenge weak plans, security risks, scaling problems, and
  maintenance traps. Use `critical-mode` when stronger pushback is needed.
- Explain before major changes: for broad, risky, or multi-file work, state the
  plan and scope before editing.
- Verify significant implementation: run relevant tests, build, typecheck, or a
  focused manual check before calling work done.
- Shared todo stores: Codex and Claude use the same files, not separate todo
  databases.
- No secrets in git, logs, reports, fixtures, PRs, issues, screenshots, or
  generated artifacts. Use env files or `vaultwarden-secrets` through `mcp2cli`;
  never invent credentials.
- Protected branches: do not commit directly to main, master, or protected
  branches unless explicitly approved.
- Search memory when it matters: use `pai-brain` or
  `mcp2cli open-brain search_all` when prior decisions or indexed context are
  likely relevant; do not force memory before every exact-path read.
- Subagents are optional: use them only when explicitly requested or when
  parallel work is genuinely useful under Codex rules.
- Ask clearly: use Codex `request_user_input` only when available; otherwise ask
  concise plain-text questions.

## Policy Refresh And Compaction Recovery

- After any context compaction, resume, checkpoint, or long-running goal-run
  continuation, task action is blocked until the agent rereads:
  - `~/.codex/AGENTS.md`
  - `/Volumes/ThunderBolt/Development/AGENTS.md`
  - this repo-local `agents.md`
  - `_agents.md`
  - every mandatory SOP triggered by the next action
- During long goal runs, refresh policy at every meaningful phase change or
  after roughly 8-10 worker/manager rounds, whichever comes first.
- For goal runs, the refresh must include `_DOCS/AGENT_WORKFLOW.md`.
- If board work is active, also read `_DOCS/BOARD_FIELDS.md` and any repo-local
  board map.
- If branch, commit, PR, issue, label, milestone, or project work is active,
  also read `_DOCS/GIT_STANDARDS.md`.
- If host, IP, SSH, LXC, VM, Proxmox, runner, DNS, Caddy, Authentik, mounts, or
  deploy facts are involved, also read `_DOCS/INFRASTRUCTURE_SOP.md`.
- If domain language, PAI terms, infra names, shorthand, or workflow terms
  matter, read `_DOCS/GLOSSARY.md` and only the routed topic glossary that is
  needed.
- Acting after compaction, resume, or phase change without refreshing policy is
  a protocol violation. Stop the drift, reread the router and relevant SOP,
  restate the controlling rule in one sentence, correct worker prompts or
  replace drifting workers, then continue unless there is a real approval gate
  or blocker.

## Mandatory SOP Routing

Detailed shared SOPs live in `/Volumes/ThunderBolt/Development/_DOCS`.

- Creating or modifying code: read `_DOCS/CODING_STANDARDS.md`.
- Branch, commit, PR, issue, label, milestone, or project-board work: read
  `_DOCS/GIT_STANDARDS.md`.
- GitHub Project board mutations: read `_DOCS/BOARD_FIELDS.md` and any
  repo-local board map first.
- Goal run, fanout, review swarm, manager/board-manager workflow, or
  long-running work: read `_DOCS/AGENT_WORKFLOW.md`.
- Infrastructure, hosts, IPs, SSH, LXC, VM, Proxmox, TrueNAS, runners, DNS,
  Caddy, Authentik, mounts, or deployments: read
  `_DOCS/INFRASTRUCTURE_SOP.md`.
- Domain language or shorthand: read `_DOCS/GLOSSARY.md`.

Repo-local docs, context, glossary, and standards override these SOPs when they
are stricter or more specific.

## Temporary Work Policy

- Use `/Volumes/ThunderBolt/_tmp` for all Codex temporary files, downloaded
  artifacts, generated patches, scratch clones, review checkouts, PR-review
  worktrees, and one-off test homes.
- Do not create temporary `codex-*`, review, scratch, or experiment directories
  in `/Volumes/ThunderBolt/Development` or this repo root.
- Do not use `/tmp` or `/private/tmp` for Codex-controlled temp work when
  `/Volumes/ThunderBolt/_tmp` is available.
- If a tool hard-requires system temp, keep only tool-managed transient files
  there and put all named artifacts under `/Volumes/ThunderBolt/_tmp`.
- Clean up your own temporary files under `/Volumes/ThunderBolt/_tmp` without
  asking by using `/Users/rico/.codex/tools/codex-clean-tmp <path>`.
- Do not use raw `rm -rf` for `/Volumes/ThunderBolt/_tmp` cleanup in agent
  workflows.
- Before starting a PR review or temporary worktree, create a clearly named
  directory under `/Volumes/ThunderBolt/_tmp` and run Codex with `-C <that path>`
  when launching a nested session.

## Worktree And Git Policy

- Never use `claude --worktree` directly.
- Use `gwt "name"` or `gwt "name" codex|pi|claude` only for durable,
  user-approved worktrees.
- PR review worktrees, review clones, scratch worktrees, and temporary
  `codex-*` work must live under `/Volumes/ThunderBolt/_tmp`, not beside repos
  in `/Volumes/ThunderBolt/Development`.
- Reading, status checks, and fetches on `main` are allowed.
- Editing, staging, or committing on `main` is not allowed unless explicitly
  approved.
- For implementation work, create a focused branch from clean current `main`
  when required by the task.
- In dedicated implementation worktrees, commit scoped agent changes before
  handoff unless the user explicitly says review-only or no-commit.

## Local Artifact Policy

- Do not create new Codex-owned hidden folders in this repo or under
  `/Volumes/ThunderBolt/Development`.
- For durable project artifacts, use visible paths such as `reports/`, `docs/`,
  `planning/`, `fixtures/`, or a user-requested location.
- For session wrap, prefer direct OpenBrain capture through
  `mcp2cli open-brain`.
- Only write visible repo files for session wrap when OpenBrain is unavailable
  or the user explicitly asks for local files.
- Never write session-wrap output to `.reports/`.

## Shared Todo Stores

- Project todos: `.planning/todos/pending/`
- Global active ideas: `/Volumes/ThunderBolt/Development/.claude_ideas/active/`
- Someday ideas: `/Volumes/ThunderBolt/Development/.claude_ideas/someday/`
- Use the `add-todo` and `check-todos` skills for todo work.
- Do not create a Codex-only todo store.

## MCP Policy

- Direct Codex MCP servers are intentionally absent here.
- MCP-backed tools go through `mcp2cli`.
- Run `mcp2cli services` for the full service list.
- For any service, `mcp2cli <service> --help` lists tools.
- For tool params, use `mcp2cli schema <service>.<tool>`.
- Credentials: use one `mcp2cli vaultwarden-secrets get_credential --params
  '{"query":"<name>"}'` call. Never chain multiple credential lookups.

Key services and wrappers:

| Service | Wrapper | Usage |
| --- | --- | --- |
| `open-brain` | `pai-brain` | `pai-brain search_all --params '{"query":"..."}'` |
| `vaultwarden-secrets` | direct | `mcp2cli vaultwarden-secrets get_credential --params '{"query":"..."}'` |
| `qmd` | direct | `mcp2cli qmd search --params '{"query":"..."}'` |
| `proxmox` | direct | `mcp2cli proxmox list_containers --params '{}'` |
| `home-assistant` | direct | `mcp2cli home-assistant <tool> --params '{}'` |
| `n8n` | direct | `mcp2cli n8n <tool> --params '{}'` |
| `unifi` | direct | `mcp2cli unifi <tool> --params '{}'` |

## n8n Workflow Ops

- Use MCP/mcp2cli-backed n8n tools only.
- If auth or MCP is broken, stop and fix that path unless the user explicitly
  says to use SSH.

## Goal-Run Execution

- Goal runs must have a controller role.
- Worker/implementation sessions are not allowed to self-declare board state, PR
  readiness, merge readiness, issue closure, or goal completion.
- Worker output is evidence, not authority.
- The controller owns live board state, issue/PR state, worker routing,
  CI/check status, review gates, final readiness, and merge/closure decisions.
- Material worker claims must be verified against live repo, GitHub, board, CI,
  and validation evidence before acting on them.
- Work through recoverable issues. A failed command, stale checkout, queued CI,
  missing local dependency, worker stall, or temporary artifact cleanup is not a
  stop condition by itself.
- Do not spawn workers merely to fill capacity. Each worker needs a concrete
  deliverable that advances the run.

## Host And Infra Policy

- Never guess IPs, container IDs, service locations, hostnames, runner targets,
  or credentials.
- Use direct IP addresses for SSH in homelab/workspace tasks after verifying the
  target through host inventory.
- Current generated HOSTMAP source of truth:
  - macOS: `/Volumes/collab/hostmap.json`
  - Linux/LXC: `/mnt/collab/hostmap.json`
- Repo-local `HOSTMAP.md` or `HOSTMAP.json` files may be stale snapshots unless
  repo-local instructions say otherwise.

## Persona

- Default persona: Skippy.
- `ACTIVE_PERSONA=skippy` is injected through Codex config.
- To switch tracked persona from the shell, run `pai-persona skippy`,
  `pai-persona bob`, `pai-persona clarisa`, or `pai-persona april`.

## Hook Policy

- Hooks are safety rails only.
- No wildcard PreToolUse or PostToolUse hooks.
- No read-only Bash hook gauntlet.
- Keep blocking checks for destructive git, protected branch push/commit,
  secrets/security, SSH target verification, LiteLLM self-surgery, and direct
  `claude --worktree` usage.

## Session Wrap

Before ending or checkpointing a session:

- Review whether `_DOCS/GLOSSARY.md`, repo-local context, glossary files, SOPs,
  or this file need updates from terms or protocols learned during the session.
- Update the relevant SOP, skill, or repo-local agent file when the user
  clarifies durable protocols.
- Prefer OpenBrain capture through `mcp2cli open-brain`; avoid local wrap files
  unless OpenBrain is unavailable or the user asks for them.
