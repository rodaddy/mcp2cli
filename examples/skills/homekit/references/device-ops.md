# homekit -- Device Operations

<!-- AUTO-GENERATED:START -->

## control_device

Control a device. Works with HomeKit and Govee. Actions: on, off, toggle, brightness (0-100), color ({hue, saturation} for HomeKit, {r, g, b} for Govee), lock, unlock, open, close.

### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| name | string | Yes | The name of the device |
| value | string | No | Value for the action |
| action | string | Yes | Action: on, off, toggle, brightness, color, lock, unlock, open, close |

### Example

```bash
mcp2cli homekit control_device --params '{"name":"value","action":"value"}'
```

## list_devices

List all devices from HomeKit and enabled plugins (Govee) with their names, rooms, types, source, and reachability status.

### Example

```bash
mcp2cli homekit list_devices
```

<!-- AUTO-GENERATED:END -->
