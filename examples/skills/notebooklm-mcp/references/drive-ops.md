# notebooklm-mcp -- Drive Operations

<!-- AUTO-GENERATED:START -->

## source_list_drive

List sources with types and Drive freshness status.

Use before source_sync_drive to identify stale sources.

Args:
    notebook_id: Notebook UUID

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |

### Example

```bash
mcp2cli notebooklm-mcp source_list_drive --params '{"notebook_id":"value"}'
```

## source_sync_drive

Sync Drive sources with latest content. Requires confirm=True.

Call source_list_drive first to identify stale sources.

Args:
    source_ids: Source UUIDs to sync
    confirm: Must be True after user approval

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| source_ids | array | Yes |  |
| confirm | boolean | No |  |

### Example

```bash
mcp2cli notebooklm-mcp source_sync_drive --params '{"source_ids":[]}'
```

<!-- AUTO-GENERATED:END -->
