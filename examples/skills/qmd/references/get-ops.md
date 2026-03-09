# qmd -- Get Operations

<!-- AUTO-GENERATED:START -->

## get

Retrieve the full content of a document by its file path or docid. Use paths or docids (#abc123) from search results. Suggests similar files if not found.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| file | string | Yes | File path or docid from search results (e.g., 'pages/meeting.md', '#abc123', or 'pages/meeting.md:100' to start at line 100) |
| fromLine | number | No | Start from this line number (1-indexed) |
| maxLines | number | No | Maximum number of lines to return |
| lineNumbers | boolean | No | Add line numbers to output (format: 'N: content') |

### Example

```bash
mcp2cli qmd get --params '{"file":"value"}'
```

## multi_get

Retrieve multiple documents by glob pattern (e.g., 'journals/2025-05*.md') or comma-separated list. Skips files larger than maxBytes.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| pattern | string | Yes | Glob pattern or comma-separated list of file paths |
| maxLines | number | No | Maximum lines per file |
| maxBytes | number | No | Skip files larger than this (default: 10240 = 10KB) |
| lineNumbers | boolean | No | Add line numbers to output (format: 'N: content') |

### Example

```bash
mcp2cli qmd multi_get --params '{"pattern":"value"}'
```

<!-- AUTO-GENERATED:END -->
