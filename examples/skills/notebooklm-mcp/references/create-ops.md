# notebooklm-mcp -- Create Operations

<!-- AUTO-GENERATED:START -->

## notebook_create

Create a new notebook.

Args:
    title: Optional title for the notebook

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| title | string | No |  |

### Example

```bash
mcp2cli notebooklm-mcp notebook_create
```

## studio_create

Create any NotebookLM studio artifact. Unified creation tool.

Supports: audio, video, infographic, slide_deck, report, flashcards, quiz, data_table, mind_map

Args:
    notebook_id: Notebook UUID
    artifact_type: Type of artifact to create:
        - audio: Audio Overview (podcast)
        - video: Video Overview
        - infographic: Visual infographic
        - slide_deck: Presentation slides (PDF)
        - report: Text report (Briefing Doc, Study Guide, etc.)
        - flashcards: Study flashcards
        - quiz: Multiple choice quiz
        - data_table: Structured data table
        - mind_map: Visual mind map
    source_ids: Source IDs to use (default: all sources)
    confirm: Must be True after user approval

    Type-specific options:
    - audio: audio_format (deep_dive|brief|critique|debate), audio_length (short|default|long)
    - video: video_format (explainer|brief), visual_style (auto_select|classic|whiteboard|kawaii|anime|watercolor|retro_print|heritage|paper_craft)
    - infographic: orientation (landscape|portrait|square), detail_level (concise|standard|detailed), infographic_style (auto_select|sketch_note|professional|bento_grid|editorial|instructional|bricks|clay|anime|kawaii|scientific)
    - slide_deck: slide_format (detailed_deck|presenter_slides), slide_length (short|default)
    - report: report_format (Briefing Doc|Study Guide|Blog Post|Create Your Own), custom_prompt
    - flashcards: difficulty (easy|medium|hard)
    - quiz: question_count (int), difficulty (easy|medium|hard)
    - data_table: description (required)
    - mind_map: title

    Common options:
    - language: BCP-47 code (en, es, fr, de, ja). Defaults to NOTEBOOKLM_HL env var or 'en'
    - focus_prompt: Optional focus text

Example:
    studio_create(notebook_id="abc", artifact_type="audio", confirm=True)
    studio_create(notebook_id="abc", artifact_type="quiz", question_count=5, confirm=True)

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| notebook_id | string | Yes |  |
| artifact_type | string | Yes |  |
| source_ids | string | No |  |
| confirm | boolean | No |  |
| audio_format | string | No |  |
| audio_length | string | No |  |
| video_format | string | No |  |
| visual_style | string | No |  |
| orientation | string | No |  |
| detail_level | string | No |  |
| infographic_style | string | No |  |
| slide_format | string | No |  |
| slide_length | string | No |  |
| report_format | string | No |  |
| custom_prompt | string | No |  |
| question_count | integer | No |  |
| difficulty | string | No |  |
| language | string | No |  |
| focus_prompt | string | No |  |
| title | string | No |  |
| description | string | No |  |

### Example

```bash
mcp2cli notebooklm-mcp studio_create --params '{"notebook_id":"value","artifact_type":"value"}'
```

<!-- AUTO-GENERATED:END -->
