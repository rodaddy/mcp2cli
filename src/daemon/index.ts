/**
 * Daemon entry point.
 * Starts the long-running daemon process with PID file, idle timer,
 * connection pool, and signal handlers for graceful shutdown.
 * Supports both Unix socket (local) and TCP (network) listen modes.
 */
import { mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { getDaemonPaths, getDaemonListenConfig } from "./paths.ts";
import { ConnectionPool } from "./pool.ts";
import { IdleTimer } from "./idle.ts";
import { createDaemonServer } from "./server.ts";
import { loadConfig, getConfigPath } from "../config/index.ts";
import { createLogger } from "../logger/index.ts";
import { MetricsCollector } from "./metrics.ts";
import { ConfigManager } from "./config-manager.ts";
import { TokenAuthProvider } from "./auth-provider.ts";

const log = createLogger("daemon");

const DEFAULT_IDLE_TIMEOUT_S = 60;

/**
 * Start the daemon process.
 * Creates PID file, loads config, starts connection pool and HTTP server.
 * In TCP mode: disables idle timer, skips PID/socket file management.
 */
export async function startDaemon(): Promise<void> {
  const listenConfig = getDaemonListenConfig();
  const isTcp = listenConfig.mode === "tcp";

  // Unix mode: manage PID and socket files
  let paths: ReturnType<typeof getDaemonPaths> | null = null;
  if (!isTcp) {
    paths = getDaemonPaths();

    // Ensure runtime directory exists
    await mkdir(dirname(paths.pidFile), { recursive: true });
    await mkdir(dirname(paths.socketPath), { recursive: true });

    // Clean up stale socket/pid from previous crash
    await unlink(paths.socketPath).catch(() => {});
    await unlink(paths.pidFile).catch(() => {});

    // Write PID file
    await Bun.write(paths.pidFile, String(process.pid) + "\n");
    log.info("daemon starting", { pid: process.pid, socket: paths.socketPath });
  } else {
    log.info("daemon starting", {
      pid: process.pid,
      mode: "tcp",
      host: listenConfig.hostname,
      port: listenConfig.port,
    });
  }

  // Load service configuration
  const config = await loadConfig();

  // Create config manager for runtime CRUD (wraps the loaded config)
  const configManager = new ConfigManager(config, getConfigPath());

  // Load auth provider (tokens.json or legacy MCP2CLI_AUTH_TOKEN)
  const authProvider = await TokenAuthProvider.load();
  if (isTcp && !authProvider.enabled) {
    log.warn("no_auth_configured", {
      message: "TCP mode without auth -- daemon is unauthenticated. Set MCP2CLI_AUTH_TOKEN or create tokens.json",
    });
  }

  // Create connection pool and metrics collector
  const pool = new ConnectionPool();
  const metrics = new MetricsCollector();

  // Wire pool into config manager for connection lifecycle
  configManager.setPool(pool);

  // Parse idle timeout from env (seconds -> ms)
  // TCP mode: default to 0 (disabled) since it's a long-running network service
  const defaultTimeout = isTcp ? 0 : DEFAULT_IDLE_TIMEOUT_S;
  const idleTimeoutS = parseInt(
    process.env.MCP2CLI_IDLE_TIMEOUT ?? String(defaultTimeout),
    10,
  );
  const idleTimeoutMs = (Number.isNaN(idleTimeoutS) ? defaultTimeout : idleTimeoutS) * 1000;

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

      // Unix mode: remove socket and PID files
      if (paths) {
        await unlink(paths.socketPath).catch(() => {});
        await unlink(paths.pidFile).catch(() => {});
      }

      clearTimeout(forceTimer);
      process.exit(0);
    } catch {
      clearTimeout(forceTimer);
      process.exit(1);
    }
  };

  // Create idle timer (disabled when timeoutMs is 0)
  const idleTimer = new IdleTimer(idleTimeoutMs, () => {
    void gracefulShutdown();
  });

  // Create and start server
  const server = createDaemonServer({
    listenConfig,
    pool,
    config,
    configManager,
    idleTimer,
    onShutdown: () => {
      void gracefulShutdown();
    },
    authProvider,
    metrics,
  });

  // Install signal handlers
  process.on("SIGTERM", () => void gracefulShutdown());
  process.on("SIGINT", () => void gracefulShutdown());
  process.on("SIGHUP", () => void gracefulShutdown());

  // Start first idle countdown (only if idle timer is enabled)
  if (idleTimeoutMs > 0) {
    idleTimer.touch();
  }
}
