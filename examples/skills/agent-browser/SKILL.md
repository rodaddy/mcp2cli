---
name: agent-browser
description: MCP tools for agent-browser
triggers:
  - agent-browser
  - page
  - browser
  - elements
  - text
  - current
  - element
  - execute
---

# agent-browser

MCP tools for agent-browser

<!-- AUTO-GENERATED:START -->

## Quick Reference

| Tool | Description |
|------|-------------|
| browser_eval | Execute arbitrary JavaScript in the browser page context and return the result. |
| browser_find | Find elements using semantic queries -- by ARIA role, visible text, label, place... |
| browser_get | Extract data from the page or elements. |
| browser_interact | Interact with page elements by ref or selector. |
| browser_navigate | Navigate the browser: open a URL, go back/forward, reload, or close the browser. |
| browser_screenshot | Capture the current page as a screenshot (PNG) or PDF. |
| browser_snapshot | Get the current page accessibility tree with element refs. |
| browser_wait | Wait for a condition: element to appear, time to pass, URL to match, or text to ... |

## Usage

```bash
mcp2cli agent-browser <tool> --params '{...}'
```

See `references/` for detailed parameter docs per tool.

<!-- AUTO-GENERATED:END -->
