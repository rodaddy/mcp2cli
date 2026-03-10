# n8n -- Node Operations

<!-- AUTO-GENERATED:START -->

## get_node

Get node info with progressive detail levels and multiple modes. Detail: minimal (~200 tokens), standard (~1-2K, default), full (~3-8K). Modes: info (default), docs (markdown documentation), search_properties (find properties), versions/compare/breaking/migrations (version info). Use format='docs' for readable documentation, mode='search_properties' with propertyQuery for finding specific fields.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| nodeType | string | Yes | Full node type: "nodes-base.httpRequest" or "nodes-langchain.agent" |
| detail | string | No | Information detail level. standard=essential properties (recommended), full=everything |
| mode | string | No | Operation mode. info=node schema, docs=readable markdown documentation, search_properties=find specific properties, versions/compare/breaking/migrations=version info |
| includeTypeInfo | boolean | No | Include type structure metadata (type category, JS type, validation rules). Only applies to mode=info. Adds ~80-120 tokens per property. |
| includeExamples | boolean | No | Include real-world configuration examples from templates. Only applies to mode=info with detail=standard. Adds ~200-400 tokens per example. |
| fromVersion | string | No | Source version for compare/breaking/migrations modes (e.g., "1.0") |
| toVersion | string | No | Target version for compare mode (e.g., "2.0"). Defaults to latest if omitted. |
| propertyQuery | string | No | For mode=search_properties: search term to find properties (e.g., "auth", "header", "body") |
| maxPropertyResults | number | No | For mode=search_properties: max results (default 20) |

### Example

```bash
mcp2cli n8n get_node --params '{"nodeType":"value"}'
```

## search_nodes

Search n8n nodes by keyword with optional real-world examples. Pass query as string. Example: query="webhook" or query="database". Returns max 20 results. Use includeExamples=true to get top 2 template configs per node.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search terms. Use quotes for exact phrase. |
| limit | number | No | Max results (default 20) |
| mode | string | No | OR=any word, AND=all words, FUZZY=typo-tolerant |
| includeExamples | boolean | No | Include top 2 real-world configuration examples from popular templates (default: false) |
| source | string | No | Filter by node source: all=everything (default), core=n8n base nodes, community=community nodes, verified=verified community nodes only |

### Example

```bash
mcp2cli n8n search_nodes --params '{"query":"value"}'
```

## validate_node

Validate n8n node configuration. Use mode='full' for comprehensive validation with errors/warnings/suggestions, mode='minimal' for quick required fields check. Example: nodeType="nodes-base.slack", config={resource:"channel",operation:"create"}

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| nodeType | string | Yes | Node type as string. Example: "nodes-base.slack" |
| config | object | Yes | Configuration as object. For simple nodes use {}. For complex nodes include fields like {resource:"channel",operation:"create"} |
| mode | string | No | Validation mode. full=comprehensive validation with errors/warnings/suggestions, minimal=quick required fields check only. Default is "full" |
| profile | string | No | Profile for mode=full: "minimal", "runtime", "ai-friendly", or "strict". Default is "ai-friendly" |

### Example

```bash
mcp2cli n8n validate_node --params '{"nodeType":"value","config":{}}'
```

<!-- AUTO-GENERATED:END -->
