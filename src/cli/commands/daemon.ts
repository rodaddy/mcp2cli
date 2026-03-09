/**
 * Daemon management commands: stop and status.
 * Provides CLI control over the background daemon process.
 */
import { getDaemonPaths } from "../../daemon/paths.ts";
import { getDaemonStatus, cleanStaleDaemon } from "../../process/index.ts";

/**
 * Handle `mcp2cli daemon stop` -- stop the running daemon.
 * Sends POST /shutdown to the daemon's Unix socket.
 */
export async function handleDaemonStop(_args: string[]): Promise<void> {
  const paths = getDaemonPaths();
  const status = await getDaemonStatus(paths);

  if (status === "stopped") {
    console.log(JSON.stringify({ status: "not_running" }));
    return;
  }

  if (status === "stale") {
    await cleanStaleDaemon(paths);
    console.log(JSON.stringify({ status: "cleaned_stale" }));
    return;
  }

  // Running -- send shutdown request
  try {
    const response = await fetch("http://localhost/shutdown", {
      unix: paths.socketPath,
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    console.log(JSON.stringify(body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ status: "error", message }));
  }
}

/**
 * Handle `mcp2cli daemon status` -- report daemon status.
 * Checks PID file, process liveness, and health endpoint.
 */
export async function handleDaemonStatus(_args: string[]): Promise<void> {
  const paths = getDaemonPaths();
  const status = await getDaemonStatus(paths);

  if (status === "stopped") {
    console.log(JSON.stringify({ status: "stopped" }));
    return;
  }

  if (status === "stale") {
    console.log(JSON.stringify({ status: "stale" }));
    return;
  }

  // Running -- get health info
  try {
    const response = await fetch("http://localhost/health", {
      unix: paths.socketPath,
      signal: AbortSignal.timeout(2000),
    });
    const body = await response.json();
    console.log(JSON.stringify(body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({ status: "error", message }));
  }
}
