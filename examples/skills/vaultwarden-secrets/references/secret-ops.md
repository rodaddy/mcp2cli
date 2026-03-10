# vaultwarden-secrets -- Secret Operations

<!-- AUTO-GENERATED:START -->

## create_secret

Create a new secret in the vault (Infrastructure folder). Supports login items (type 1) and secure notes (type 2) with custom fields. Triggers snapshot refresh after creation.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Name for the new secret |
| type | number | No | Item type: 1=login (default), 2=secure note. Use type 2 with custom fields for API tokens. |
| username | string | No | Login username (type 1 only) |
| password | string | No | Login password (type 1 only) |
| uri | string | No | Login URI (type 1 only, e.g. https://example.com) |
| notes | string | No | Notes field |
| fields | array | No | Custom fields (e.g. API tokens on secure notes) |

### Example

```bash
mcp2cli vaultwarden-secrets create_secret --params '{"name":"value"}'
```

## delete_secret

Delete a secret from the vault. Only secrets in allowed folders can be deleted. Triggers snapshot refresh.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Name of the secret to delete |

### Example

```bash
mcp2cli vaultwarden-secrets delete_secret --params '{"name":"value"}'
```

## get_secret

Get a secret value by name

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Secret name or path (e.g. "github-pat", "github-pat.login.password") |
| vault | string | No | Vault ID (default: "default") |

### Example

```bash
mcp2cli vaultwarden-secrets get_secret --params '{"name":"value"}'
```

## list_secrets

List available secrets with optional filter

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| filter | string | No | Filter string (case-insensitive) |
| vault | string | No | Vault ID |

### Example

```bash
mcp2cli vaultwarden-secrets list_secrets
```

## search_secrets

Fuzzy search for secrets by name

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query |
| limit | number | No | Max results |
| vault | string | No | Vault ID (default: "default") |

### Example

```bash
mcp2cli vaultwarden-secrets search_secrets --params '{"query":"value"}'
```

## update_secret

Update an existing secret. Supports login fields and custom fields. Only secrets in allowed folders can be modified. Triggers snapshot refresh.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Name of the secret to update |
| username | string | No | New username (omit to keep current) |
| password | string | No | New password (omit to keep current) |
| uri | string | No | New URI (omit to keep current) |
| notes | string | No | New notes (omit to keep current) |
| fields | array | No | Custom fields to add/update |
| fieldStrategy | string | No | 'merge' (default): update existing fields by name, append new. 'replace': overwrite all fields. |

### Example

```bash
mcp2cli vaultwarden-secrets update_secret --params '{"name":"value"}'
```

<!-- AUTO-GENERATED:END -->
