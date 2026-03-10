# vaultwarden-secrets -- General

<!-- AUTO-GENERATED:START -->

## get_credential

Smart single-call credential lookup. Tries exact name match first, falls back to fuzzy search. Returns value, all fields, and item metadata in one response. Use this instead of chaining search_secrets -> get_secret_fields -> get_secret.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Secret name (exact) or search term (fuzzy). Examples: "n8n local", "grafana", "PostgreSQL n8n-ops" |
| field | string | No | Specific field to extract (e.g. "login.password", "login.username", "notes"). Omit to get all fields. |
| vault | string | No | Vault ID (default: "default") |

### Example

```bash
mcp2cli vaultwarden-secrets get_credential --params '{"query":"value"}'
```

## get_secret_fields

Get all fields for a secret item

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Secret item name |
| vault | string | No | Vault ID |

### Example

```bash
mcp2cli vaultwarden-secrets get_secret_fields --params '{"name":"value"}'
```

## get_service

Get all vault items for a service (API credentials + per-host entries). Uses naming convention: SERVICE_API for shared credentials, service01/02/etc for hosts.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| service | string | Yes | Service name prefix (e.g. "proxmox", "redis", "github") |

### Example

```bash
mcp2cli vaultwarden-secrets get_service --params '{"service":"value"}'
```

## refresh_snapshot

Force a snapshot refresh from the live vault. Use when snapshot_info shows stale data.

### Example

```bash
mcp2cli vaultwarden-secrets refresh_snapshot
```

## snapshot_info

Get vault snapshot metadata (age, item count, staleness)

### Example

```bash
mcp2cli vaultwarden-secrets snapshot_info
```

<!-- AUTO-GENERATED:END -->
