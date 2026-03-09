/**
 * Daemon entry point.
 * Starts the long-running daemon process with PID file, idle timer,
 * connection pool, and signal handlers for graceful shutdown.
 */
import { mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { getDaemonPaths } from "./paths.ts";
import { ConnectionPool } from "./pool.ts";
import { IdleTimer } from "./idle.ts";
import { createDaemonServer } from "./server.ts";
import { loadConfig } from "../config/index.ts";
import { createLogger } from "../logger/index.ts";

const log = createLogger("daemon");

const DEFAULT_IDLE_TIMEOUT_S = 60;

/**
 * Start the daemon process.
 * Creates PID file, loads config, starts connection pool and HTTP server.
 */
export async function startDaemon(): Promise<void> {
  const paths = getDaemonPaths();

  // Ensure runtime directory exists
  await mkdir(dirname(paths.pidFile), { recursive: true });
  await mkdir(dirname(paths.socketPath), { recursive: true });

  // Write PID file
  await Bun.write(paths.pidFile, String(process.pid) + "\n");
  log.info("daemon starting", { pid: process.pid, socket: paths.socketPath });

  // Load service configuration
  const config = await loadConfig();

  // Create connection pool
  const pool = new ConnectionPool();

  // Parse idle timeout from env (seconds -> ms)
  const idleTimeoutS = parseInt(
    process.env.MCP2CLI_IDLE_TIMEOUT ?? String(DEFAULT_IDLE_TIMEOUT_S),
    10,
  );
  const idleTimeoutMs = (Number.isNaN(idleTimeoutS) ? DEFAULT_IDLE_TIMEOUT_S : idleTimeoutS) * 1000;

  // Graceful shutdown function
  let isShuttingDown = false;
  const gracefulShutdown = async (): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.info("daemon shutting down");

    // Force exit after 10s if graceful shutdown stalls
    const forceTimer = setTimeout(() => {
      process.exit(1);
    }, 10_000);

    try {
      // Stop accepting new connections
      server.stop(true);

      // Close all MCP connections (reuses McpTransport.close() multi-step shutdown)
      await pool.closeAll();

      // Remove socket and PID files
      await unlink(paths.socketPath).catch(() => {});
      await unlink(paths.pidFile).catch(() => {});

      clearTimeout(forceTimer);
      process.exit(0);
    } catch {
      clearTimeout(forceTimer);
      process.exit(1);
    }
  };

  // Create idle timer
  const idleTimer = new IdleTimer(idleTimeoutMs, () => {
    void gracefulShutdown();
  });

  // Create and start server
  const server = createDaemonServer({
    socketPath: paths.socketPath,
    pool,
    config,
    idleTimer,
    onShutdown: () => {
      void gracefulShutdown();
    },
  });

  // Install signal handlers
  process.on("SIGTERM", () => void gracefulShutdown());
  process.on("SIGINT", () => void gracefulShutdown());
  process.on("SIGHUP", () => void gracefulShutdown());

  // Start first idle countdown
  idleTimer.touch();
}
