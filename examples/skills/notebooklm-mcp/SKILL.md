---
name: notebooklm-mcp
description: MCP tools for notebooklm-mcp
triggers:
  - notebooklm-mcp
  - notebook
  - sources
  - artifact
  - source
  - notebooklm
  - delete
  - rename
---

# notebooklm-mcp

MCP tools for notebooklm-mcp

<!-- AUTO-GENERATED:START -->

## Quick Reference

| Tool | Description |
|------|-------------|
| chat_configure | Configure notebook chat settings. |
| download_artifact | Download any NotebookLM artifact to a file. |
| export_artifact | Export a NotebookLM artifact to Google Docs or Sheets. |
| note | Manage notes in a notebook. |
| notebook_create | Create a new notebook. |
| notebook_delete | Delete notebook permanently. |
| notebook_describe | Get AI-generated notebook summary with suggested topics. |
| notebook_get | Get notebook details with sources. |
| notebook_list | List all notebooks. |
| notebook_query | Ask AI about EXISTING sources already in notebook. |
| notebook_rename | Rename a notebook. |
| notebook_share_invite | Invite a collaborator by email. |
| notebook_share_public | Enable or disable public link access. |
| notebook_share_status | Get current sharing settings and collaborators. |
| refresh_auth | Reload auth tokens from disk or run headless re-authentication. |
| research_import | Import discovered sources into notebook. |
| research_start | Deep research / fast research: Search web or Google Drive to FIND NEW sources. |
| research_status | Poll research progress. |
| save_auth_tokens | Save NotebookLM cookies (FALLBACK method - try `nlm login` first!). |
| server_info | Get server version and check for updates. |
| source_add | Add a source to a notebook. |
| source_delete | Delete source(s) permanently. |
| source_describe | Get AI-generated source summary with keyword chips. |
| source_get_content | Get raw text content of a source (no AI processing). |
| source_list_drive | List sources with types and Drive freshness status. |
| source_rename | Rename a source in a notebook. |
| source_sync_drive | Sync Drive sources with latest content. |
| studio_create | Create any NotebookLM studio artifact. |
| studio_delete | Delete studio artifact. |
| studio_revise | Revise individual slides in an existing slide deck. |
| studio_status | Check studio content generation status and get URLs, or rename an artifact. |

## Usage

```bash
mcp2cli notebooklm-mcp <tool> --params '{...}'
```

See `references/` for detailed parameter docs per tool.

<!-- AUTO-GENERATED:END -->
