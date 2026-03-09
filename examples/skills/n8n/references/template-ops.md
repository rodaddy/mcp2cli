# n8n -- Template Operations

<!-- AUTO-GENERATED:START -->

## get_template

Get template by ID. Use mode to control response size: nodes_only (minimal), structure (nodes+connections), full (complete workflow).

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| templateId | number | Yes | The template ID to retrieve |
| mode | string | No | Response detail level. nodes_only: just node list, structure: nodes+connections, full: complete workflow JSON. |

### Example

```bash
mcp2cli n8n get_template --params '{"templateId":1}'
```

## n8n_deploy_template

Deploy a workflow template from n8n.io directly to your n8n instance. Deploys first, then auto-fixes common issues (expression format, typeVersions). Returns workflow ID, required credentials, and fixes applied.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| templateId | number | Yes | Template ID from n8n.io (required) |
| name | string | No | Custom workflow name (default: template name) |
| autoUpgradeVersions | boolean | No | Automatically upgrade node typeVersions to latest supported (default: true) |
| autoFix | boolean | No | Auto-apply fixes after deployment for expression format issues, missing = prefix, etc. (default: true) |
| stripCredentials | boolean | No | Remove credential references from nodes - user configures in n8n UI (default: true) |

### Example

```bash
mcp2cli n8n n8n_deploy_template --params '{"templateId":1}'
```

## search_templates

Search templates with multiple modes. Use searchMode='keyword' for text search, 'by_nodes' to find templates using specific nodes, 'by_task' for curated task-based templates, 'by_metadata' for filtering by complexity/setup time/services.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| searchMode | string | No | Search mode. keyword=text search (default), by_nodes=find by node types, by_task=curated task templates, by_metadata=filter by complexity/services |
| query | string | No | For searchMode=keyword: search keyword (e.g., "chatbot") |
| fields | array | No | For searchMode=keyword: fields to include in response. Default: all fields. |
| nodeTypes | array | No | For searchMode=by_nodes: array of node types (e.g., ["n8n-nodes-base.httpRequest", "n8n-nodes-base.slack"]) |
| task | string | No | For searchMode=by_task: the type of task |
| category | string | No | For searchMode=by_metadata: filter by category (e.g., "automation", "integration") |
| complexity | string | No | For searchMode=by_metadata: filter by complexity level |
| maxSetupMinutes | number | No | For searchMode=by_metadata: maximum setup time in minutes |
| minSetupMinutes | number | No | For searchMode=by_metadata: minimum setup time in minutes |
| requiredService | string | No | For searchMode=by_metadata: filter by required service (e.g., "openai", "slack") |
| targetAudience | string | No | For searchMode=by_metadata: filter by target audience (e.g., "developers", "marketers") |
| limit | number | No | Maximum number of results. Default 20. |
| offset | number | No | Pagination offset. Default 0. |

### Example

```bash
mcp2cli n8n search_templates
```

<!-- AUTO-GENERATED:END -->
