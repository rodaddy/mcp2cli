# n8n -- General

<!-- AUTO-GENERATED:START -->

## n8n_executions

Manage workflow executions: get details, list, or delete. Use action='get' with id for execution details, action='list' for listing executions, action='delete' to remove execution record.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| action | string | Yes | Operation: get=get execution details, list=list executions, delete=delete execution |
| id | string | No | Execution ID (required for action=get or action=delete) |
| mode | string | No | For action=get: preview=structure only, summary=2 items (default), filtered=custom, full=all data, error=optimized error debugging |
| nodeNames | array | No | For action=get with mode=filtered: filter to specific nodes by name |
| itemsLimit | number | No | For action=get with mode=filtered: items per node (0=structure, 2=default, -1=unlimited) |
| includeInputData | boolean | No | For action=get: include input data in addition to output (default: false) |
| errorItemsLimit | number | No | For action=get with mode=error: sample items from upstream node (default: 2, max: 100) |
| includeStackTrace | boolean | No | For action=get with mode=error: include full stack trace (default: false, shows truncated) |
| includeExecutionPath | boolean | No | For action=get with mode=error: include execution path leading to error (default: true) |
| fetchWorkflow | boolean | No | For action=get with mode=error: fetch workflow for accurate upstream detection (default: true) |
| limit | number | No | For action=list: number of executions to return (1-100, default: 100) |
| cursor | string | No | For action=list: pagination cursor from previous response |
| workflowId | string | No | For action=list: filter by workflow ID |
| projectId | string | No | For action=list: filter by project ID (enterprise feature) |
| status | string | No | For action=list: filter by execution status |
| includeData | boolean | No | For action=list: include execution data (default: false) |

### Example

```bash
mcp2cli n8n n8n_executions --params '{"action":"value"}'
```

## n8n_health_check

Check n8n instance health and API connectivity. Use mode='diagnostic' for detailed troubleshooting with env vars and tool status.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| mode | string | No | Mode: "status" (default) for quick health check, "diagnostic" for detailed debug info including env vars and tool status |
| verbose | boolean | No | Include extra details in diagnostic mode (default: false) |

### Example

```bash
mcp2cli n8n n8n_health_check
```

## n8n_workflow_versions

Manage workflow version history, rollback, and cleanup. Six modes:
- list: Show version history for a workflow
- get: Get details of specific version
- rollback: Restore workflow to previous version (creates backup first)
- delete: Delete specific version or all versions for a workflow
- prune: Manually trigger pruning to keep N most recent versions
- truncate: Delete ALL versions for ALL workflows (requires confirmation)

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| mode | string | Yes | Operation mode |
| workflowId | string | No | Workflow ID (required for list, rollback, delete, prune) |
| versionId | number | No | Version ID (required for get mode and single version delete, optional for rollback) |
| limit | number | No | Max versions to return in list mode |
| validateBefore | boolean | No | Validate workflow structure before rollback |
| deleteAll | boolean | No | Delete all versions for workflow (delete mode only) |
| maxVersions | number | No | Keep N most recent versions (prune mode only) |
| confirmTruncate | boolean | No | REQUIRED: Must be true to truncate all versions (truncate mode only) |

### Example

```bash
mcp2cli n8n n8n_workflow_versions --params '{"mode":"value"}'
```

## tools_documentation

Get documentation for n8n MCP tools. Call without parameters for quick start guide. Use topic parameter to get documentation for specific tools. Use depth='full' for comprehensive documentation.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| topic | string | No | Tool name (e.g., "search_nodes") or "overview" for general guide. Leave empty for quick reference. |
| depth | string | No | Level of detail. "essentials" (default) for quick reference, "full" for comprehensive docs. |

### Example

```bash
mcp2cli n8n tools_documentation
```

<!-- AUTO-GENERATED:END -->
