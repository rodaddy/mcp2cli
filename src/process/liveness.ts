/**
 * PID file and liveness detection for the daemon process.
 * Checks whether a daemon is running, stale, or stopped.
 */
import { readFileSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import type { DaemonPaths } from "../daemon/types.ts";
import type { DaemonStatus } from "./types.ts";

/**
 * Check whether a PID belongs to a process that is actually running.
 *
 * `kill(pid, 0)` alone is not enough on Linux: a child that has exited but
 * has not been reaped still owns its PID as a zombie, and signal 0 succeeds
 * against it. Wherever the parent is not reaping -- a container whose PID 1
 * is `tail -f /dev/null`, which is exactly how act_runner starts a job
 * container -- a stopped daemon reads as running forever, so it is never
 * treated as stale and never cleaned up (Forge issue #75).
 *
 * `/proc/<pid>/stat` field 3 is the state character, and `Z` is zombie. It is
 * read from the text after the LAST `)` because field 2 is the comm name in
 * parentheses and may itself contain spaces or parentheses. Platforms without
 * /proc have no zombie visibility, so the signal-0 answer stands.
 */
export function isPidAlive(pid: number): boolean {
  try {
    // signal 0 checks process existence without actually sending a signal
    process.kill(pid, 0);
  } catch (err) {
    // EPERM means the process EXISTS but belongs to another user -- the
    // signal was refused, not undeliverable. Reporting that as dead would
    // let getDaemonStatus call it stale and unlink a live daemon's files.
    // Only ESRCH ("no such process") actually proves it is gone.
    if ((err as NodeJS.ErrnoException)?.code === "EPERM") return true;
    return false;
  }
  // Only Linux has /proc. Elsewhere (macOS) there is no zombie visibility at
  // all, so the signal-0 answer is the best available and ENOENT below would
  // otherwise be misread as "reaped" for every live process.
  if (process.platform !== "linux") return true;

  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
    const state = stat.slice(stat.lastIndexOf(")") + 1).trim().charAt(0);
    return state !== "Z";
  } catch (err) {
    // ENOENT on Linux means the process was reaped between the kill and this
    // read: genuinely gone, so reporting it alive would be backwards. Any
    // other error (EACCES on a hardened /proc, a mount that is not there)
    // leaves no better answer than the signal-0 result, which said alive.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    return true;
  }
}

/**
 * Check if a daemon process is alive by reading its PID file
 * and verifying the process exists and has not become a zombie.
 */
export async function isDaemonAlive(pidFile: string): Promise<boolean> {
  try {
    const content = await readFile(pidFile, "utf-8");
    const pid = parseInt(content.trim(), 10);
    if (Number.isNaN(pid)) return false;

    return isPidAlive(pid);
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
