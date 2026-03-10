# notebooklm-mcp -- Describe Operations

<!-- AUTO-GENERATED:START -->

## notebook_describe

Get AI-generated notebook summary with suggested topics.

Args:
    notebook_id: Notebook UUID

Returns: summary (markdown), suggested_topics list

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |

### Example

```bash
mcp2cli notebooklm-mcp notebook_describe --params '{"notebook_id":"value"}'
```

## source_describe

Get AI-generated source summary with keyword chips.

Args:
    source_id: Source UUID

Returns: summary (markdown with **bold** keywords), keywords list

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| source_id | string | Yes |  |

### Example

```bash
mcp2cli notebooklm-mcp source_describe --params '{"source_id":"value"}'
```

<!-- AUTO-GENERATED:END -->
