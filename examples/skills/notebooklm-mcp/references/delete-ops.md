# notebooklm-mcp -- Delete Operations

<!-- AUTO-GENERATED:START -->

## notebook_delete

Delete notebook permanently. IRREVERSIBLE. Requires confirm=True.

Args:
    notebook_id: Notebook UUID
    confirm: Must be True after user approval

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| confirm | boolean | No |  |

### Example

```bash
mcp2cli notebooklm-mcp notebook_delete --params '{"notebook_id":"value"}'
```

## source_delete

Delete source(s) permanently. IRREVERSIBLE. Requires confirm=True.

Args:
    source_id: Source UUID to delete (single)
    source_ids: List of source UUIDs to delete (bulk, alternative to source_id)
    confirm: Must be True after user approval

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| source_id | string | No |  |
| source_ids | string | No |  |
| confirm | boolean | No |  |

### Example

```bash
mcp2cli notebooklm-mcp source_delete
```

## studio_delete

Delete studio artifact. IRREVERSIBLE. Requires confirm=True.

Args:
    notebook_id: Notebook UUID
    artifact_id: Artifact UUID (from studio_status)
    confirm: Must be True after user approval

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| artifact_id | string | Yes |  |
| confirm | boolean | No |  |

### Example

```bash
mcp2cli notebooklm-mcp studio_delete --params '{"notebook_id":"value","artifact_id":"value"}'
```

<!-- AUTO-GENERATED:END -->
