# n8n -- Workflow Operations

<!-- AUTO-GENERATED:START -->

## n8n_autofix_workflow

Automatically fix common workflow validation errors. Preview fixes or apply them. Fixes expression format, typeVersion, error output config, webhook paths, connection structure issues (numeric keys, invalid types, ID-to-name, duplicates, out-of-bounds indices).

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string | Yes | Workflow ID to fix |
| applyFixes | boolean | No | Apply fixes to workflow (default: false - preview mode) |
| fixTypes | array | No | Types of fixes to apply (default: all) |
| confidenceThreshold | string | No | Minimum confidence level for fixes (default: medium) |
| maxFixes | number | No | Maximum number of fixes to apply (default: 50) |

### Example

```bash
mcp2cli n8n n8n_autofix_workflow --params '{"id":"value"}'
```

## n8n_create_workflow

Create workflow. Requires: name, nodes[], connections{}. Created inactive. Returns workflow with ID.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | Workflow name (required) |
| nodes | array | Yes | Array of workflow nodes. Each node must have: id, name, type, typeVersion, position, and parameters |
| connections | object | Yes | Workflow connections object. Keys are source node names (the name field, not id), values define output connections |
| settings | object | No | Optional workflow settings (execution order, timezone, error handling) |

### Example

```bash
mcp2cli n8n n8n_create_workflow --params '{"name":"value","nodes":[],"connections":{}}'
```

## n8n_delete_workflow

Permanently delete a workflow. This action cannot be undone.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string | Yes | Workflow ID to delete |

### Example

```bash
mcp2cli n8n n8n_delete_workflow --params '{"id":"value"}'
```

## n8n_get_workflow

Get workflow by ID with different detail levels. Use mode='full' for complete workflow, 'details' for metadata+stats, 'structure' for nodes/connections only, 'minimal' for id/name/active/tags.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string | Yes | Workflow ID |
| mode | string | No | Detail level: full=complete workflow, details=full+execution stats, structure=nodes/connections topology, minimal=metadata only |

### Example

```bash
mcp2cli n8n n8n_get_workflow --params '{"id":"value"}'
```

## n8n_list_workflows

List workflows (minimal metadata only). Returns id/name/active/dates/tags. Check hasMore/nextCursor for pagination.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| limit | number | No | Number of workflows to return (1-100, default: 100) |
| cursor | string | No | Pagination cursor from previous response |
| active | boolean | No | Filter by active status |
| tags | array | No | Filter by tags (exact match) |
| projectId | string | No | Filter by project ID (enterprise feature) |
| excludePinnedData | boolean | No | Exclude pinned data from response (default: true) |

### Example

```bash
mcp2cli n8n n8n_list_workflows
```

## n8n_test_workflow

Test/trigger workflow execution. Auto-detects trigger type (webhook/form/chat). Supports: webhook (HTTP), form (fields), chat (message). Note: Only workflows with these trigger types can be executed externally.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| workflowId | string | Yes | Workflow ID to execute (required) |
| triggerType | string | No | Trigger type. Auto-detected if not specified. Workflow must have a matching trigger node. |
| httpMethod | string | No | For webhook: HTTP method (default: from workflow config or POST) |
| webhookPath | string | No | For webhook: override the webhook path |
| message | string | No | For chat: message to send (required for chat triggers) |
| sessionId | string | No | For chat: session ID for conversation continuity |
| data | object | No | Input data/payload for webhook, form fields, or execution data |
| headers | object | No | Custom HTTP headers |
| timeout | number | No | Timeout in ms (default: 120000) |
| waitForResponse | boolean | No | Wait for workflow completion (default: true) |

### Example

```bash
mcp2cli n8n n8n_test_workflow --params '{"workflowId":"value"}'
```

## n8n_update_full_workflow

Full workflow update. Requires complete nodes[] and connections{}. For incremental use n8n_update_partial_workflow.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string | Yes | Workflow ID to update |
| name | string | No | New workflow name |
| nodes | array | No | Complete array of workflow nodes (required if modifying workflow structure) |
| connections | object | No | Complete connections object (required if modifying workflow structure) |
| settings | object | No | Workflow settings to update |

### Example

```bash
mcp2cli n8n n8n_update_full_workflow --params '{"id":"value"}'
```

## n8n_update_partial_workflow

Update workflow incrementally with diff operations. Types: addNode, removeNode, updateNode, moveNode, enable/disableNode, addConnection, removeConnection, updateSettings, updateName, add/removeTag. See tools_documentation("n8n_update_partial_workflow", "full") for details.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string | Yes | Workflow ID to update |
| operations | array | Yes | Array of diff operations to apply. Each operation must have a "type" field and relevant properties for that operation type. |
| validateOnly | boolean | No | If true, only validate operations without applying them |
| continueOnError | boolean | No | If true, apply valid operations even if some fail (best-effort mode). Returns applied and failed operation indices. Default: false (atomic) |

### Example

```bash
mcp2cli n8n n8n_update_partial_workflow --params '{"id":"value","operations":[]}'
```

## n8n_validate_workflow

Validate workflow by ID. Checks nodes, connections, expressions. Returns errors/warnings/suggestions.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| id | string | Yes | Workflow ID to validate |
| options | object | No | Validation options |

### Example

```bash
mcp2cli n8n n8n_validate_workflow --params '{"id":"value"}'
```

## validate_workflow

Full workflow validation: structure, connections, expressions, AI tools. Returns errors/warnings/fixes. Essential before deploy.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| workflow | object | Yes | The complete workflow JSON to validate. Must include nodes array and connections object. |
| options | object | No | Optional validation settings |

### Example

```bash
mcp2cli n8n validate_workflow --params '{"workflow":{}}'
```

<!-- AUTO-GENERATED:END -->
