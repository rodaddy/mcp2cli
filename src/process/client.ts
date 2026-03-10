/**
 * CLI-side daemon communication client.
 * Starts the daemon if needed, sends requests over Unix socket.
 * Supports remote daemon connections via MCP2CLI_REMOTE_URL.
 */
import { mkdir, stat, unlink } from "node:fs/promises";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { constants } from "node:fs";
import { getDaemonPaths, getRemoteConfig } from "../daemon/paths.ts";
import { ConnectionError } from "../connection/errors.ts";
import { getDaemonStatus, cleanStaleDaemon } from "./liveness.ts";
import type { DaemonPaths } from "../daemon/types.ts";
import type {
  DaemonCallRequest,
  DaemonListToolsRequest,
  DaemonSchemaRequest,
  DaemonResponse,
} from "../daemon/types.ts";

const STARTUP_TIMEOUT_MS = 10_000;
const STARTUP_POLL_MS = 50;
const REQUEST_TIMEOUT_MS = 60_000;
const STALE_LOCK_THRESHOLD_MS = 30_000;

/** Cached local token to avoid re-reading tokens.json on every request. */
let cachedLocalToken: string | undefined;
let localTokenResolved = false;

/**
 * Resolve a bearer token for local Unix socket connections.
 * Reads tokens.json and returns the first admin token.
 * Falls back to MCP2CLI_AUTH_TOKEN env var.
 * Caches the result for the process lifetime.
 */
async function getLocalToken(): Promise<string | undefined> {
  if (localTokenResolved) return cachedLocalToken;
  localTokenResolved = true;

  // Check env var first
  const envToken = process.env.MCP2CLI_AUTH_TOKEN;
  if (envToken) {
    cachedLocalToken = envToken;
    return cachedLocalToken;
  }

  // Read tokens.json
  const tokensPath = process.env.MCP2CLI_TOKENS_FILE
    ?? join(process.env.HOME ?? "", ".config", "mcp2cli", "tokens.json");
  try {
    const file = Bun.file(tokensPath);
    if (await file.exists()) {
      const raw = await file.json() as { tokens?: Array<{ token: string; role: string }> };
      // Use the first admin token for local socket auth
      const adminEntry = raw.tokens?.find((t) => t.role === "admin");
      cachedLocalToken = adminEntry?.token;
    }
  } catch {
    // tokens.json missing or malformed -- auth may be disabled
  }
  return cachedLocalToken;
}

/**
 * Start the daemon as a background process.
 * Detects dev vs compiled mode for correct spawn args.
 */
export async function startDaemonProcess(
  paths: DaemonPaths,
): Promise<void> {
  // Ensure runtime directory exists
  await mkdir(dirname(paths.pidFile), { recursive: true });

  // Determine spawn args based on execution mode
  const isDev = process.argv[1] !== undefined && Bun.main === process.argv[1];

  const cmd: string[] = isDev
    ? [process.execPath, ...process.execArgv, process.argv[1]!]
    : [process.argv[0]!];

  const proc = Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      MCP2CLI_DAEMON: "1",
      MCP2CLI_PID_FILE: paths.pidFile,
      MCP2CLI_SOCKET_PATH: paths.socketPath,
    },
  });

  proc.unref();

  await waitForDaemonReady(paths, { timeout: STARTUP_TIMEOUT_MS });
}

/**
 * Poll the daemon's /health endpoint until it responds or timeout.
 */
export async function waitForDaemonReady(
  paths: DaemonPaths,
  opts?: { timeout?: number },
): Promise<void> {
  const timeout = opts?.timeout ?? STARTUP_TIMEOUT_MS;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://localhost/health", {
        unix: paths.socketPath,
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      // Not ready yet -- keep polling
    }
    await new Promise((r) => setTimeout(r, STARTUP_POLL_MS));
  }

  throw new ConnectionError(
    `Daemon failed to start within ${timeout}ms`,
    "startup_timeout",
  );
}

/**
 * Attempt to acquire a startup lock (atomic file creation).
 * Returns true if lock acquired, false if already locked.
 */
async function acquireStartLock(paths: DaemonPaths): Promise<boolean> {
  const lockPath = paths.pidFile + ".lock";
  try {
    const fd = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    await fd.close();
    return true;
  } catch {
    return false;
  }
}

/** Release the startup lock file (best-effort). */
async function releaseStartLock(paths: DaemonPaths): Promise<void> {
  const lockPath = paths.pidFile + ".lock";
  await unlink(lockPath).catch(() => {});
}

/**
 * Ensure the daemon is running. Start it if needed.
 * Serializes concurrent startup attempts via lock file.
 * Recovers from stale locks older than 30s.
 */
export async function ensureDaemon(paths: DaemonPaths): Promise<void> {
  const status = await getDaemonStatus(paths);
  if (status === "running") return;
  if (status === "stale") {
    await cleanStaleDaemon(paths);
  }

  // Attempt to acquire startup lock
  let lockAcquired = await acquireStartLock(paths);
  if (!lockAcquired) {
    // Stale lock recovery: if the lock file is older than 30s,
    // the process that created it likely crashed. Force-remove and retry.
    const lockPath = paths.pidFile + ".lock";
    const lockStat = await stat(lockPath).catch(() => null);
    if (lockStat && Date.now() - lockStat.mtimeMs > STALE_LOCK_THRESHOLD_MS) {
      await unlink(lockPath).catch(() => {});
      lockAcquired = await acquireStartLock(paths);
    }
  }

  if (!lockAcquired) {
    // Another CLI is actively starting the daemon -- just wait for it
    await waitForDaemonReady(paths, { timeout: STARTUP_TIMEOUT_MS });
    return;
  }

  // We own the lock -- start the daemon
  try {
    await startDaemonProcess(paths);
  } finally {
    await releaseStartLock(paths);
  }
}

/**
 * Shared fetch helper that routes to remote or local daemon.
 * - Remote: uses MCP2CLI_REMOTE_URL with Bearer token, skips ensureDaemon()
 * - Local: ensures daemon is running, fetches via Unix socket
 */
async function fetchDaemon(
  path: string,
  body?: unknown,
): Promise<DaemonResponse> {
  const remote = getRemoteConfig();

  try {
    let response: Response;

    if (remote) {
      // Remote mode -- direct HTTP to remote daemon
      const url = `${remote.url.replace(/\/$/, "")}${path}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (remote.token) {
        headers["Authorization"] = `Bearer ${remote.token}`;
      }
      response = await fetch(url, {
        method: "POST",
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } else {
      // Local mode -- Unix socket
      const paths = getDaemonPaths();
      await ensureDaemon(paths);
      const localHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const localToken = await getLocalToken();
      if (localToken) {
        localHeaders["Authorization"] = `Bearer ${localToken}`;
      }
      response = await fetch(`http://localhost${path}`, {
        unix: paths.socketPath,
        method: "POST",
        headers: localHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    }

    return (await response.json()) as DaemonResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const target = remote ? `remote daemon at ${remote.url}` : "daemon";
    return {
      success: false,
      error: {
        code: "CONNECTION_ERROR",
        message: `Failed to communicate with ${target}: ${message}`,
      },
    };
  }
}

/**
 * Send a tool call request to the daemon.
 */
export async function callViaDaemon(
  request: DaemonCallRequest,
): Promise<DaemonResponse> {
  return fetchDaemon("/call", request);
}

/**
 * Send a list-tools request to the daemon.
 */
export async function listToolsViaDaemon(
  request: DaemonListToolsRequest,
): Promise<DaemonResponse> {
  return fetchDaemon("/list-tools", request);
}

/**
 * Send a schema request to the daemon.
 */
export async function getSchemaViaDaemon(
  request: DaemonSchemaRequest,
): Promise<DaemonResponse> {
  return fetchDaemon("/schema", request);
}
