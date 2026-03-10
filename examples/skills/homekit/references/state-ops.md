# homekit -- State Operations

<!-- AUTO-GENERATED:START -->

## get_device_state

Get the current state of a device (on/off, brightness, color, etc.). Works with HomeKit and Govee devices.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | The name of the device |

### Example

```bash
mcp2cli homekit get_device_state --params '{"name":"value"}'
```

## get_motion_state

Get the current motion detection state of a sensor.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | The name of the motion sensor |

### Example

```bash
mcp2cli homekit get_motion_state --params '{"name":"value"}'
```

## scrypted_get_camera_state

Get the current state of a Scrypted camera including motion detection status.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| camera_name | string | No | The name of the camera (alternative to camera_id) |
| camera_id | string | No | The Scrypted device ID of the camera |

### Example

```bash
mcp2cli homekit scrypted_get_camera_state
```

<!-- AUTO-GENERATED:END -->
