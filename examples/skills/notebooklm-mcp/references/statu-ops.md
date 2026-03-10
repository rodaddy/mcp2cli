# notebooklm-mcp -- Statu Operations

<!-- AUTO-GENERATED:START -->

## notebook_share_status

Get current sharing settings and collaborators.

Args:
    notebook_id: Notebook UUID

Returns: is_public, access_level, collaborators list, and public_link if public

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |

### Example

```bash
mcp2cli notebooklm-mcp notebook_share_status --params '{"notebook_id":"value"}'
```

## research_status

Poll research progress. Blocks until complete or timeout.

Args:
    notebook_id: Notebook UUID
    poll_interval: Seconds between polls (default: 30)
    max_wait: Max seconds to wait (default: 300, 0=single poll)
    compact: If True (default), truncate report and limit sources shown to save tokens.
            Use compact=False to get full details.
    task_id: Optional Task ID to poll for a specific research task.
    query: Optional query text for fallback matching when task_id changes (deep research).
        Contributed by @saitrogen (PR #15).

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| poll_interval | integer | No |  |
| max_wait | integer | No |  |
| compact | boolean | No |  |
| task_id | string | No |  |
| query | string | No |  |

### Example

```bash
mcp2cli notebooklm-mcp research_status --params '{"notebook_id":"value"}'
```

## studio_status

Check studio content generation status and get URLs, or rename an artifact.

Args:
    notebook_id: Notebook UUID
    action: Action to perform:
        - status (default): List all artifacts with their status and URLs
        - rename: Rename an artifact (requires artifact_id and new_title)
    artifact_id: Required for action="rename" - the artifact UUID to rename
    new_title: Required for action="rename" - the new title for the artifact

Returns:
    Dictionary with status and results.
    For action="status":
        - status: "success"
        - artifacts: List of artifacts, each containing:
            - artifact_id: UUID
            - title: Artifact title
            - type: audio, video, report, etc.
            - status: completed, in_progress, failed
            - url: URL to view/download (if applicable)
            - custom_instructions: The custom prompt/focus instructions used to generate the artifact (if any)
        - summary: Counts of total, completed, in_progress

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| action | string | No |  |
| artifact_id | string | No |  |
| new_title | string | No |  |

### Example

```bash
mcp2cli notebooklm-mcp studio_status --params '{"notebook_id":"value"}'
```

<!-- AUTO-GENERATED:END -->
