/**
 * PID file and liveness detection for the daemon process.
 * Checks whether a daemon is running, stale, or stopped.
 */
import { readFile, unlink } from "node:fs/promises";
import type { DaemonPaths } from "../daemon/types.ts";
import type { DaemonStatus } from "./types.ts";

/**
 * Check if a daemon process is alive by reading its PID file
 * and sending signal 0 to verify the process exists.
 */
export async function isDaemonAlive(pidFile: string): Promise<boolean> {
  try {
    const content = await readFile(pidFile, "utf-8");
    const pid = parseInt(content.trim(), 10);
    if (Number.isNaN(pid)) return false;

    // signal 0 checks process existence without actually sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the full daemon status by checking PID file, process liveness,
 * and socket health endpoint.
 *
 * Returns:
 * - "stopped": no PID file exists
 * - "stale": PID file exists but process dead or socket unresponsive
 * - "running": health check passes
 */
export async function getDaemonStatus(
  paths: DaemonPaths,
): Promise<DaemonStatus> {
  // Check if PID file exists
  const alive = await isDaemonAlive(paths.pidFile);
  if (!alive) {
    // Check if PID file even exists (vs process just dead)
    try {
      await readFile(paths.pidFile, "utf-8");
      // PID file exists but process is dead
      return "stale";
    } catch {
      // No PID file at all
      return "stopped";
    }
  }

  // Process is alive -- verify socket responds to health check
  try {
    const response = await fetch("http://localhost/health", {
      unix: paths.socketPath,
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) return "running";
    return "stale";
  } catch {
    return "stale";
  }
}

/**
 * Clean up stale daemon files (PID file and socket).
 * Best-effort: swallows ENOENT errors.
 */
export async function cleanStaleDaemon(paths: DaemonPaths): Promise<void> {
  await unlink(paths.pidFile).catch(() => {});
  await unlink(paths.socketPath).catch(() => {});
}

/**
 * Check health of a remote daemon via HTTP.
 * Returns status "ok" with response data on success,
 * or "unreachable" on any error.
 */
export async function checkRemoteHealth(
  url: string,
  token: string | undefined,
): Promise<{ status: "ok" | "unreachable"; data?: unknown }> {
  try {
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const response = await fetch(`${url.replace(/\/$/, "")}/health`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    return { status: "ok", data };
  } catch {
    return { status: "unreachable" };
  }
}
