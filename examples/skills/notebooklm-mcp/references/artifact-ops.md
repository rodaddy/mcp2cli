# notebooklm-mcp -- Artifact Operations

<!-- AUTO-GENERATED:START -->

## download_artifact

Download any NotebookLM artifact to a file.

Unified download tool replacing 9 separate download tools.
Supports all artifact types: audio, video, report, mind_map, slide_deck,
infographic, data_table, quiz, flashcards.

Args:
    notebook_id: Notebook UUID
    artifact_type: Type of artifact to download:
        - audio: Audio Overview (MP4/MP3)
        - video: Video Overview (MP4)
        - report: Report (Markdown)
        - mind_map: Mind Map (JSON)
        - slide_deck: Slide Deck (PDF or PPTX)
        - infographic: Infographic (PNG)
        - data_table: Data Table (CSV)
        - quiz: Quiz (json|markdown|html)
        - flashcards: Flashcards (json|markdown|html)
    output_path: Path to save the file
    artifact_id: Optional specific artifact ID (uses latest if not provided)
    output_format: For quiz/flashcards only: json|markdown|html (default: json)
    slide_deck_format: For slide_deck only: pdf (default) or pptx

Returns:
    dict with status and saved file path

Example:
    download_artifact(notebook_id="abc123", artifact_type="audio", output_path="podcast.mp3")
    download_artifact(notebook_id="abc123", artifact_type="quiz", output_path="quiz.html", output_format="html")
    download_artifact(notebook_id="abc123", artifact_type="slide_deck", output_path="slides.pptx", slide_deck_format="pptx")

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| artifact_type | string | Yes |  |
| output_path | string | Yes |  |
| artifact_id | string | No |  |
| output_format | string | No |  |
| slide_deck_format | string | No |  |

### Example

```bash
mcp2cli notebooklm-mcp download_artifact --params '{"notebook_id":"value","artifact_type":"value","output_path":"value"}'
```

## export_artifact

Export a NotebookLM artifact to Google Docs or Sheets.

Supports:
- Data Tables → Google Sheets
- Reports (Briefing Doc, Study Guide, Blog Post) → Google Docs

Args:
    notebook_id: Notebook UUID
    artifact_id: Artifact UUID to export
    export_type: "docs" or "sheets"
    title: Title for exported document (optional)

Returns: URL to the created Google Doc/Sheet

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| artifact_id | string | Yes |  |
| export_type | string | Yes |  |
| title | string | No |  |

### Example

```bash
mcp2cli notebooklm-mcp export_artifact --params '{"notebook_id":"value","artifact_id":"value","export_type":"value"}'
```

<!-- AUTO-GENERATED:END -->
