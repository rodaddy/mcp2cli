# mcp2cli Agent Quick Router

Read `agents.md` first. This file is the compact repo-local checklist for future
sessions in `/Volumes/ThunderBolt/Development/mcp2cli`.

## Required Policy Refresh

Before task action after compaction, resume, checkpoint, phase change, or
long-running continuation, reread:

- `~/.codex/AGENTS.md`
- `/Volumes/ThunderBolt/Development/AGENTS.md`
- `agents.md`
- this `_agents.md`
- triggered SOPs in `/Volumes/ThunderBolt/Development/_DOCS`

Do not continue from memory alone.

## Triggered SOPs

- Code edits: `_DOCS/CODING_STANDARDS.md`
- Git, branch, commit, PR, issue, label, milestone, or project work:
  `_DOCS/GIT_STANDARDS.md`
- GitHub Project board mutation: `_DOCS/BOARD_FIELDS.md` plus any repo-local map
- Goal run, fanout, swarm, manager, board-manager, or long-running work:
  `_DOCS/AGENT_WORKFLOW.md`
- Infra, host, IP, SSH, LXC, VM, Proxmox, runner, DNS, Caddy, Authentik, mounts,
  or deploy work: `_DOCS/INFRASTRUCTURE_SOP.md`
- Domain language, PAI terms, infra names, shorthand, or workflow terms:
  `_DOCS/GLOSSARY.md`

## Non-Negotiables

- This is Codex, not Claude Code. Use Codex-native tools and config.
- Skills first when a skill matches the task.
- Use `/opt/homebrew/bin/bash` when bash is needed.
- Use `/Volumes/ThunderBolt/_tmp` for temp files, scratch clones, generated
  patches, downloads, review checkouts, and temporary worktrees.
- Clean temp work with `/Users/rico/.codex/tools/codex-clean-tmp <path>`.
- Do not use raw `rm -rf` for `/Volumes/ThunderBolt/_tmp` cleanup.
- Do not create hidden Codex-owned folders or `.reports/`.
- Use visible durable artifact paths such as `reports/`, `docs/`, or
  user-requested locations.
- Never put secrets in git, logs, reports, fixtures, PRs, issues, screenshots,
  or generated artifacts.
- Do not edit, stage, or commit on `main` unless explicitly approved.
- Never use `claude --worktree` directly.
- Temporary/review worktrees belong under `/Volumes/ThunderBolt/_tmp`, not under
  `/Volumes/ThunderBolt/Development`.
- Use shared todo stores through `add-todo` and `check-todos`; do not create a
  Codex-only todo database.

## MCP And Service Access

- Direct Codex MCP servers are intentionally absent.
- Use `mcp2cli` for MCP-backed tools.
- Use `mcp2cli services`, `mcp2cli <service> --help`, and
  `mcp2cli schema <service>.<tool>` for discovery.
- Use one `mcp2cli vaultwarden-secrets get_credential --params
  '{"query":"<name>"}'` call for credentials; never chain credential lookups.
- For n8n workflow ops, use MCP/mcp2cli-backed tools only unless the user
  explicitly says to use SSH.

## Goal Runs

- Establish a controller before broad implementation continues.
- Workers provide evidence; they do not declare board state, PR readiness, merge
  readiness, issue closure, or goal completion.
- Verify worker claims against live repo, GitHub, board, CI, and validation
  evidence before acting.
- Continue through recoverable failures; report only real blockers with
  evidence.

## Infra

- Never guess IPs, container IDs, service locations, hostnames, runner targets,
  or credentials.
- Use direct IPs for SSH after verifying host inventory.
- Hostmap sources:
  - macOS: `/Volumes/collab/hostmap.json`
  - Linux/LXC: `/mnt/collab/hostmap.json`

## Persona And Hooks

- Default persona is Skippy; `ACTIVE_PERSONA=skippy` is expected.
- Hooks are safety rails only.
- No wildcard PreToolUse or PostToolUse hooks.
- No read-only Bash hook gauntlet.
