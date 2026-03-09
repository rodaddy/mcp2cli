# qmd -- General

<!-- AUTO-GENERATED:START -->

## query

Highest quality search combining BM25 + vector + query expansion + LLM reranking. Slower but most accurate. Use for important searches.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Natural language query - describe what you're looking for |
| limit | number | No | Maximum number of results (default: 10) |
| minScore | number | No | Minimum relevance score 0-1 (default: 0) |
| collection | string | No | Filter to a specific collection by name |

### Example

```bash
mcp2cli qmd query --params '{"query":"value"}'
```

## search

Fast keyword-based full-text search using BM25. Best for finding documents with specific words or phrases.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query - keywords or phrases to find |
| limit | number | No | Maximum number of results (default: 10) |
| minScore | number | No | Minimum relevance score 0-1 (default: 0) |
| collection | string | No | Filter to a specific collection by name |

### Example

```bash
mcp2cli qmd search --params '{"query":"value"}'
```

## status

Show the status of the QMD index: collections, document counts, and health information.

### Example

```bash
mcp2cli qmd status
```

## vsearch

Semantic similarity search using vector embeddings. Finds conceptually related content even without exact keyword matches. Requires embeddings (run 'qmd embed' first).

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Natural language query - describe what you're looking for |
| limit | number | No | Maximum number of results (default: 10) |
| minScore | number | No | Minimum relevance score 0-1 (default: 0.3) |
| collection | string | No | Filter to a specific collection by name |

### Example

```bash
mcp2cli qmd vsearch --params '{"query":"value"}'
```

<!-- AUTO-GENERATED:END -->
