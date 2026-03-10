---
name: qmd
description: MCP tools for qmd
triggers:
  - qmd
  - search
  - retrieve
  - full
  - document
  - bm25
  - vector
  - using
---

# qmd

MCP tools for qmd

<!-- AUTO-GENERATED:START -->

## Quick Reference

| Tool | Description |
|------|-------------|
| get | Retrieve the full content of a document by its file path or docid. |
| multi_get | Retrieve multiple documents by glob pattern (e. |
| query | Highest quality search combining BM25 + vector + query expansion + LLM reranking... |
| search | Fast keyword-based full-text search using BM25. |
| status | Show the status of the QMD index: collections, document counts, and health infor... |
| vsearch | Semantic similarity search using vector embeddings. |

## Usage

```bash
mcp2cli qmd <tool> --params '{...}'
```

See `references/` for detailed parameter docs per tool.

<!-- AUTO-GENERATED:END -->

## Notes

<!-- MANUAL:START -->
<!-- Add your custom notes, examples, or overrides here -->
<!-- MANUAL:END -->
