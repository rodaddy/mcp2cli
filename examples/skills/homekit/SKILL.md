---
name: homekit
description: MCP tools for homekit
triggers:
  - homekit
  - motion
  - list
  - camera
  - current
  - state
  - detection
---

# homekit

MCP tools for homekit

<!-- AUTO-GENERATED:START -->

## Quick Reference

| Tool | Description |
|------|-------------|
| capture_snapshot | Capture a snapshot from a HomeKit camera. |
| control_device | Control a device. |
| get_device_state | Get the current state of a device (on/off, brightness, color, etc. |
| get_motion_state | Get the current motion detection state of a sensor. |
| get_pending_events | Get buffered motion/doorbell events. |
| list_cameras | List all HomeKit cameras. |
| list_devices | List all devices from HomeKit and enabled plugins (Govee) with their names, room... |
| list_homes | List all HomeKit homes configured on this Mac. |
| list_motion_sensors | List all motion sensors, occupancy sensors, and doorbells in HomeKit. |
| list_rooms | List all rooms in all HomeKit homes. |
| scrypted_capture_snapshot | Capture a snapshot from a Scrypted camera. |
| scrypted_get_camera_state | Get the current state of a Scrypted camera including motion detection status. |
| scrypted_list_cameras | List all cameras from Scrypted NVR with their capabilities (motion detection, au... |
| subscribe_events | Enable motion event buffering. |

## Usage

```bash
mcp2cli homekit <tool> --params '{...}'
```

See `references/` for detailed parameter docs per tool.

<!-- AUTO-GENERATED:END -->
