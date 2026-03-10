# notebooklm-mcp -- Rename Operations

<!-- AUTO-GENERATED:START -->

## notebook_rename

Rename a notebook.

Args:
    notebook_id: Notebook UUID
    new_title: New title

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| new_title | string | Yes |  |

### Example

```bash
mcp2cli notebooklm-mcp notebook_rename --params '{"notebook_id":"value","new_title":"value"}'
```

## source_rename

Rename a source in a notebook.

Args:
    notebook_id: Notebook UUID containing the source
    source_id: Source UUID to rename
    new_title: New display title for the source

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| source_id | string | Yes |  |
| new_title | string | Yes |  |

### Example

```bash
mcp2cli notebooklm-mcp source_rename --params '{"notebook_id":"value","source_id":"value","new_title":"value"}'
```

<!-- AUTO-GENERATED:END -->
