# notebooklm-mcp -- General

<!-- AUTO-GENERATED:START -->

## chat_configure

Configure notebook chat settings.

Args:
    notebook_id: Notebook UUID
    goal: default|learning_guide|custom
    custom_prompt: Required when goal=custom (max 10000 chars)
    response_length: default|longer|shorter

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| goal | string | No |  |
| custom_prompt | string | No |  |
| response_length | string | No |  |

### Example

```bash
mcp2cli notebooklm-mcp chat_configure --params '{"notebook_id":"value"}'
```

## note

Manage notes in a notebook. Unified tool for all note operations.

Supports: create, list, update, delete

Args:
    notebook_id: Notebook UUID
    action: Operation to perform:
        - create: Create a new note
        - list: List all notes in notebook
        - update: Update an existing note
        - delete: Delete a note permanently (requires confirm=True)
    note_id: Note UUID (required for update/delete)
    content: Note content (required for create, optional for update)
    title: Note title (optional for create/update)
    confirm: Must be True for delete action

Returns:
    Action-specific response with status

Example:
    note(notebook_id="abc", action="list")
    note(notebook_id="abc", action="create", content="My note", title="Title")
    note(notebook_id="abc", action="update", note_id="xyz", content="Updated")
    note(notebook_id="abc", action="delete", note_id="xyz", confirm=True)

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| action | string | Yes |  |
| note_id | string | No |  |
| content | string | No |  |
| title | string | No |  |
| confirm | boolean | No |  |

### Example

```bash
mcp2cli notebooklm-mcp note --params '{"notebook_id":"value","action":"value"}'
```

## notebook_get

Get notebook details with sources.

Args:
    notebook_id: Notebook UUID

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |

### Example

```bash
mcp2cli notebooklm-mcp notebook_get --params '{"notebook_id":"value"}'
```

## notebook_list

List all notebooks.

Args:
    max_results: Maximum number of notebooks to return (default: 100)

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| max_results | integer | No |  |

### Example

```bash
mcp2cli notebooklm-mcp notebook_list
```

## notebook_query

Ask AI about EXISTING sources already in notebook. NOT for finding new sources.

Use research_start instead for: deep research, web search, find new sources, Drive search.

Args:
    notebook_id: Notebook UUID
    query: Question to ask
    source_ids: Source IDs to query (default: all)
    conversation_id: For follow-up questions
    timeout: Request timeout in seconds (default: from env NOTEBOOKLM_QUERY_TIMEOUT or 120.0)

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| query | string | Yes |  |
| source_ids | string | No |  |
| conversation_id | string | No |  |
| timeout | string | No |  |

### Example

```bash
mcp2cli notebooklm-mcp notebook_query --params '{"notebook_id":"value","query":"value"}'
```

## notebook_share_invite

Invite a collaborator by email.

Args:
    notebook_id: Notebook UUID
    email: Email address to invite
    role: "viewer" or "editor" (default: viewer)

Returns: success status

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| email | string | Yes |  |
| role | string | No |  |

### Example

```bash
mcp2cli notebooklm-mcp notebook_share_invite --params '{"notebook_id":"value","email":"value"}'
```

## notebook_share_public

Enable or disable public link access.

Args:
    notebook_id: Notebook UUID
    is_public: True to enable public link, False to disable (default: True)

Returns: public_link if enabled, None if disabled

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| is_public | boolean | No |  |

### Example

```bash
mcp2cli notebooklm-mcp notebook_share_public --params '{"notebook_id":"value"}'
```

## refresh_auth

Reload auth tokens from disk or run headless re-authentication.

Call this after running `nlm login` to pick up new tokens,
or to attempt automatic re-authentication if Chrome profile has saved login.

Returns status indicating if tokens were refreshed successfully.

### Example

```bash
mcp2cli notebooklm-mcp refresh_auth
```

## research_import

Import discovered sources into notebook.

Call after research_status shows status="completed".

Args:
    notebook_id: Notebook UUID
    task_id: Research task ID
    source_indices: Source indices to import (default: all)

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| task_id | string | Yes |  |
| source_indices | string | No |  |

### Example

```bash
mcp2cli notebooklm-mcp research_import --params '{"notebook_id":"value","task_id":"value"}'
```

## research_start

Deep research / fast research: Search web or Google Drive to FIND NEW sources.

Use this for: "deep research on X", "find sources about Y", "search web for Z", "search Drive".
Workflow: research_start -> poll research_status -> research_import.

Args:
    query: What to search for (e.g. "quantum computing advances")
    source: web|drive (where to search)
    mode: fast (~30s, ~10 sources) | deep (~5min, ~40 sources, web only)
    notebook_id: Existing notebook (creates new if not provided)
    title: Title for new notebook

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes |  |
| source | string | No |  |
| mode | string | No |  |
| notebook_id | string | No |  |
| title | string | No |  |

### Example

```bash
mcp2cli notebooklm-mcp research_start --params '{"query":"value"}'
```

## save_auth_tokens

Save NotebookLM cookies (FALLBACK method - try `nlm login` first!).

IMPORTANT FOR AI ASSISTANTS:
- First, run `nlm login` via Bash/terminal (automated, preferred)
- Only use this tool if the automated CLI fails

Args:
    cookies: Cookie header from Chrome DevTools (only needed if CLI fails)
    csrf_token: Deprecated - auto-extracted
    session_id: Deprecated - auto-extracted
    request_body: Optional - contains CSRF if extracting manually
    request_url: Optional - contains session ID if extracting manually

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| cookies | string | Yes |  |
| csrf_token | string | No |  |
| session_id | string | No |  |
| request_body | string | No |  |
| request_url | string | No |  |

### Example

```bash
mcp2cli notebooklm-mcp save_auth_tokens --params '{"cookies":"value"}'
```

## server_info

Get server version and check for updates.

AI assistants: If update_available is True, inform the user that a new
version is available and suggest updating with the provided command.

Returns:
    dict with version info:
    - version: Current installed version
    - latest_version: Latest version on PyPI (or None if check failed)
    - update_available: True if a newer version exists
    - update_command: Command to run to update

### Example

```bash
mcp2cli notebooklm-mcp server_info
```

## source_add

Add a source to a notebook. Unified tool for all source types.

Supports: url, text, drive, file

Args:
    notebook_id: Notebook UUID
    source_type: Type of source to add:
        - url: Web page or YouTube URL
        - text: Pasted text content
        - drive: Google Drive document
        - file: Local file upload (PDF, text, audio)
    url: URL to add (for source_type=url)
    urls: List of URLs to add in bulk (for source_type=url, alternative to url)
    text: Text content to add (for source_type=text)
    title: Display title (for text sources)
    file_path: Local file path (for source_type=file)
    document_id: Google Drive document ID (for source_type=drive)
    doc_type: Drive doc type: doc|slides|sheets|pdf (for source_type=drive)
    wait: If True, wait for source processing to complete before returning
    wait_timeout: Max seconds to wait if wait=True (default 120)

Example:
    source_add(notebook_id="abc", source_type="url", url="https://example.com")
    source_add(notebook_id="abc", source_type="url", urls=["https://a.com", "https://b.com"])
    source_add(notebook_id="abc", source_type="url", url="https://example.com", wait=True)
    source_add(notebook_id="abc", source_type="file", file_path="/path/to/doc.pdf", wait=True)

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| source_type | string | Yes |  |
| url | string | No |  |
| urls | string | No |  |
| text | string | No |  |
| title | string | No |  |
| file_path | string | No |  |
| document_id | string | No |  |
| doc_type | string | No |  |
| wait | boolean | No |  |
| wait_timeout | number | No |  |

### Example

```bash
mcp2cli notebooklm-mcp source_add --params '{"notebook_id":"value","source_type":"value"}'
```

## source_get_content

Get raw text content of a source (no AI processing).

Returns the original indexed text from PDFs, web pages, pasted text,
or YouTube transcripts. Much faster than notebook_query for content export.

Args:
    source_id: Source UUID

Returns: content (str), title (str), source_type (str), char_count (int)

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| source_id | string | Yes |  |

### Example

```bash
mcp2cli notebooklm-mcp source_get_content --params '{"source_id":"value"}'
```

## studio_revise

Revise individual slides in an existing slide deck. Creates a NEW artifact.

Only slide decks support revision. The original artifact is not modified.
Poll studio_status after calling to check when the new deck is ready.

Args:
    notebook_id: Notebook UUID
    artifact_id: UUID of the existing slide deck to revise (from studio_status)
    slide_instructions: List of revision instructions, each with:
        - slide: Slide number (1-based, slide 1 = first slide)
        - instruction: Text describing the desired change
        Example: [{"slide": 1, "instruction": "Make the title larger"}]
    confirm: Must be True after user approval

Example:
    studio_revise(
        notebook_id="abc",
        artifact_id="xyz",
        slide_instructions=[
            {"slide": 1, "instruction": "Make the title larger"},
            {"slide": 3, "instruction": "Remove the image"}
        ],
        confirm=True
    )

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| artifact_id | string | Yes |  |
| slide_instructions | array | Yes |  |
| confirm | boolean | No |  |

### Example

```bash
mcp2cli notebooklm-mcp studio_revise --params '{"notebook_id":"value","artifact_id":"value","slide_instructions":[]}'
```

<!-- AUTO-GENERATED:END -->
