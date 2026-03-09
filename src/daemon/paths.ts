/**
 * Runtime path resolution for daemon PID file and Unix socket.
 * Supports XDG_RUNTIME_DIR, macOS fallback, and env var overrides.
 */
import { join } from "node:path";
import type { DaemonPaths } from "./types.ts";

const APP_DIR = "mcp2cli";
const PID_FILENAME = "daemon.pid";
const SOCKET_FILENAME = "daemon.sock";

/**
 * Resolve daemon runtime file paths.
 *
 * Priority order:
 * 1. MCP2CLI_PID_FILE / MCP2CLI_SOCKET_PATH env vars (highest priority)
 * 2. overrides.runtimeDir parameter
 * 3. XDG_RUNTIME_DIR/mcp2cli/
 * 4. ~/.config/mcp2cli/run/ (macOS/fallback)
 */
export function getDaemonPaths(overrides?: {
  runtimeDir?: string;
}): DaemonPaths {
  // Priority 1: individual env var overrides
  const envPidFile = process.env.MCP2CLI_PID_FILE;
  const envSocketPath = process.env.MCP2CLI_SOCKET_PATH;

  // Determine base directory for defaults
  let baseDir: string;
  if (overrides?.runtimeDir) {
    // Priority 2: explicit override
    baseDir = join(overrides.runtimeDir, APP_DIR);
  } else if (process.env.XDG_RUNTIME_DIR) {
    // Priority 3: XDG standard
    baseDir = join(process.env.XDG_RUNTIME_DIR, APP_DIR);
  } else {
    // Priority 4: macOS/fallback
    const home = process.env.HOME ?? "/tmp";
    baseDir = join(home, ".config", APP_DIR, "run");
  }

  return {
    pidFile: envPidFile ?? join(baseDir, PID_FILENAME),
    socketPath: envSocketPath ?? join(baseDir, SOCKET_FILENAME),
  };
}
