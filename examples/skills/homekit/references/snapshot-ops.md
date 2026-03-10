# homekit -- Snapshot Operations

<!-- AUTO-GENERATED:START -->

## capture_snapshot

Capture a snapshot from a HomeKit camera. Returns base64-encoded JPEG image.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | The name of the camera |

### Example

```bash
mcp2cli homekit capture_snapshot --params '{"name":"value"}'
```

## scrypted_capture_snapshot

Capture a snapshot from a Scrypted camera. Returns base64-encoded JPEG image.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| camera_id | string | No | The Scrypted device ID of the camera |
| camera_name | string | No | The name of the camera (alternative to camera_id) |

### Example

```bash
mcp2cli homekit scrypted_capture_snapshot
```

<!-- AUTO-GENERATED:END -->
