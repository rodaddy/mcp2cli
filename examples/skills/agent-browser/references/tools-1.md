# agent-browser -- Tools (Part 1)

<!-- AUTO-GENERATED:START -->

## browser_eval

Execute arbitrary JavaScript in the browser page context and return the result.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| script | string | Yes | JavaScript code to evaluate in the page |
| session | string | No | Named session for browser isolation (optional, default: shared) |

### Example

```bash
mcp2cli agent-browser browser_eval --params '{"script":"value"}'
```

## browser_find

Find elements using semantic queries -- by ARIA role, visible text, label, placeholder, or test ID. Returns matching element info.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| by | string | Yes | How to find the element |
| value | string | Yes | The value to search for |
| session | string | No | Named session for browser isolation (optional, default: shared) |

### Example

```bash
mcp2cli agent-browser browser_find --params '{"by":"value","value":"value"}'
```

## browser_get

Extract data from the page or elements. Get text content, HTML, input values, attributes, page title, URL, or element count.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| what | string | Yes | What to retrieve |
| selector | string | No | CSS selector or @ref (required for text/html/value/attr/count) |
| attribute | string | No | Attribute name (required when what="attr") |
| session | string | No | Named session for browser isolation (optional, default: shared) |

### Example

```bash
mcp2cli agent-browser browser_get --params '{"what":"value"}'
```

## browser_interact

Interact with page elements by ref or selector. Actions: click, fill (clear+type), type (append), press (keyboard), select (dropdown), check, uncheck, hover, scroll.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| action | string | Yes | Interaction to perform |
| selector | string | No | CSS selector or @ref from snapshot (e.g. "@ref=42"). Not needed for press/scroll. |
| value | string | No | Text to fill/type, key to press (e.g. "Enter"), option value for select, or scroll direction (up/down/left/right) |
| scrollAmount | number | No | Pixels to scroll (optional, used with scroll action) |
| session | string | No | Named session for browser isolation (optional, default: shared) |

### Example

```bash
mcp2cli agent-browser browser_interact --params '{"action":"value"}'
```

## browser_navigate

Navigate the browser: open a URL, go back/forward, reload, or close the browser.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| action | string | Yes | Navigation action to perform |
| url | string | No | URL to open (required for "open" action) |
| session | string | No | Named session for browser isolation (optional, default: shared) |

### Example

```bash
mcp2cli agent-browser browser_navigate --params '{"action":"value"}'
```

## browser_screenshot

Capture the current page as a screenshot (PNG) or PDF. Returns the file path where the capture was saved.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| format | string | No | Capture format (default: screenshot) |
| path | string | No | Output file path (optional, auto-generated if omitted) |
| session | string | No | Named session for browser isolation (optional, default: shared) |

### Example

```bash
mcp2cli agent-browser browser_screenshot
```

## browser_snapshot

Get the current page accessibility tree with element refs. Returns a text representation that AI can interpret to find interactive elements. Use refs (e.g. @ref=42) in subsequent interact/get calls.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| session | string | No | Named session for browser isolation (optional, default: shared) |

### Example

```bash
mcp2cli agent-browser browser_snapshot
```

## browser_wait

Wait for a condition: element to appear, time to pass, URL to match, or text to appear.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| for | string | Yes | What to wait for |
| value | string | Yes | CSS selector, milliseconds, URL pattern, or text to wait for |
| session | string | No | Named session for browser isolation (optional, default: shared) |

### Example

```bash
mcp2cli agent-browser browser_wait --params '{"for":"value","value":"value"}'
```

<!-- AUTO-GENERATED:END -->
