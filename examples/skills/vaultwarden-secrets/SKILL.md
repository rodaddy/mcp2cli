---
name: vaultwarden-secrets
description: MCP tools for vaultwarden-secrets
triggers:
  - vaultwarden-secrets
  - secret
  - vault
  - name
  - item
  - secrets
  - snapshot
  - create
---

# vaultwarden-secrets

MCP tools for vaultwarden-secrets

<!-- AUTO-GENERATED:START -->

## Quick Reference

| Tool | Description |
|------|-------------|
| create_secret | Create a new secret in the vault (Infrastructure folder). |
| delete_secret | Delete a secret from the vault. |
| get_credential | Smart single-call credential lookup. |
| get_secret | Get a secret value by name |
| get_secret_fields | Get all fields for a secret item |
| get_service | Get all vault items for a service (API credentials + per-host entries). |
| list_secrets | List available secrets with optional filter |
| refresh_snapshot | Force a snapshot refresh from the live vault. |
| search_secrets | Fuzzy search for secrets by name |
| snapshot_info | Get vault snapshot metadata (age, item count, staleness) |
| update_secret | Update an existing secret. |

## Usage

```bash
mcp2cli vaultwarden-secrets <tool> --params '{...}'
```

See `references/` for detailed parameter docs per tool.

<!-- AUTO-GENERATED:END -->

## Notes

<!-- MANUAL:START -->
<!-- Add your custom notes, examples, or overrides here -->
<!-- MANUAL:END -->
