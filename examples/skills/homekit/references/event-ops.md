# homekit -- Event Operations

<!-- AUTO-GENERATED:START -->

## get_pending_events

Get buffered motion/doorbell events. Use this to poll for new motion events.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| since | string | No | ISO8601 timestamp to filter events after this time |
| clear | boolean | No | Clear events after retrieving (default false) |
| limit | integer | No | Maximum number of events to return (default 50) |

### Example

```bash
mcp2cli homekit get_pending_events
```

## subscribe_events

Enable motion event buffering. Events will be stored and can be retrieved with get_pending_events.

### Example

```bash
mcp2cli homekit subscribe_events
```

<!-- AUTO-GENERATED:END -->
