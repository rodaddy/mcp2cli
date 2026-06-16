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
import { getRemoteServiceAvailability } from "./remote-discovery.ts";
import type { ServiceSource, ServicesConfig } from "../config/index.ts";
import type { DaemonPaths } from "../daemon/types.ts";
import type {
  DaemonCallRequest,
  DaemonListToolsRequest,
  DaemonSchemaRequest,
  DaemonResponse,
} from "../daemon/types.ts";

function readPositiveIntEnv(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const STARTUP_TIMEOUT_MS = readPositiveIntEnv("MCP2CLI_STARTUP_TIMEOUT", 10_000);
const STARTUP_POLL_MS = 50;
const REQUEST_TIMEOUT_MS = 60_000;
const REMOTE_CONNECT_TIMEOUT_MS = 10_000;
const STALE_LOCK_THRESHOLD_MS = 30_000;

/** Cached local token to avoid re-reading tokens.json on every request. */
let cachedLocalToken: string | undefined;
let cachedLocalTokenExpiresAt: string | undefined;
let localTokenResolved = false;

/**
 * Resolve a bearer token for local Unix socket connections.
 * Reads tokens.json and returns the first admin token.
 * Falls back to MCP2CLI_AUTH_TOKEN env var only when no remote URL is configured
 * (otherwise the env var is the remote token, not the local one).
 * Caches the result for the process lifetime.
 */
async function getLocalToken(): Promise<string | undefined> {
  if (localTokenResolved) return cachedLocalToken;
  localTokenResolved = true;

  // Only use MCP2CLI_AUTH_TOKEN for local auth when no remote URL is set,
  // otherwise the token belongs to the remote daemon
  const envToken = process.env.MCP2CLI_AUTH_TOKEN ?? process.env.MCP_TOKEN;
  if (envToken && !process.env.MCP2CLI_REMOTE_URL && !process.env.MCP_HOST) {
    cachedLocalToken = envToken;
    cachedLocalTokenExpiresAt = undefined;
    return cachedLocalToken;
  }

  // Read tokens.json
  const tokensPath = process.env.MCP2CLI_TOKENS_FILE
    ?? join(process.env.HOME ?? "", ".config", "mcp2cli", "tokens.json");
  try {
    const file = Bun.file(tokensPath);
    if (await file.exists()) {
      const raw = await file.json() as { tokens?: Array<{ token: string; role: string; expiresAt?: string }> };
      // Use the first non-expired admin token for local socket auth.
      const adminEntry = raw.tokens?.find((t) => t.role === "admin" && !isExpiredToken(t.expiresAt));
      cachedLocalToken = adminEntry?.token;
      cachedLocalTokenExpiresAt = adminEntry?.expiresAt;
    }
  } catch {
    // tokens.json missing or malformed -- auth may be disabled
  }
  return cachedLocalToken;
}

function isExpiredToken(expiresAt: string | undefined): boolean {
  if (!expiresAt) return false;
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now();
}

async function buildLocalHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const localToken = await getLocalToken();
  if (localToken) {
    headers["Authorization"] = `Bearer ${localToken}`;
  }
  return headers;
}

async function refreshLocalToken(paths: DaemonPaths, token: string): Promise<boolean> {
  const response = await fetch("http://localhost/api/auth/refresh", {
    unix: paths.socketPath,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => null);
  if (!response?.ok) {
    return reloadLocalTokenIfChanged(token);
  }
  const body = await response.json().catch(() => null) as { token?: unknown; expiresAt?: unknown } | null;
  if (typeof body?.token !== "string") return reloadLocalTokenIfChanged(token);
  cachedLocalToken = body.token;
  cachedLocalTokenExpiresAt = typeof body.expiresAt === "string" ? body.expiresAt : undefined;
  localTokenResolved = true;
  return true;
}

async function reloadLocalTokenIfChanged(previousToken: string): Promise<boolean> {
  clearLocalTokenCache();
  const latestToken = await getLocalToken();
  return latestToken !== undefined && latestToken !== previousToken;
}

async function refreshLocalTokenIfNearExpiry(paths: DaemonPaths): Promise<void> {
  const token = await getLocalToken();
  if (!token || !cachedLocalTokenExpiresAt) return;
  const expiresAtMs = Date.parse(cachedLocalTokenExpiresAt);
  if (Number.isNaN(expiresAtMs)) return;
  const refreshWindowMs = parseInt(process.env.MCP2CLI_TOKEN_REFRESH_WINDOW_MS ?? String(24 * 60 * 60 * 1000), 10);
  const windowMs = Number.isFinite(refreshWindowMs) && refreshWindowMs > 0
    ? refreshWindowMs
    : 24 * 60 * 60 * 1000;
  if (expiresAtMs - Date.now() <= windowMs) {
    await refreshLocalToken(paths, token);
  }
}

export function clearLocalTokenCache(): void {
  cachedLocalToken = undefined;
  cachedLocalTokenExpiresAt = undefined;
  localTokenResolved = false;
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
 * Cached local config for source routing.
 * Intentionally process-lifetime cached: CLI is short-lived, so re-reading
 * config on every request adds latency with no benefit.
 */
let cachedConfig: ServicesConfig | null = null;

export function clearClientConfigCache(): void {
  cachedConfig = null;
}

async function getLocalConfig(): Promise<ServicesConfig | null> {
  if (!cachedConfig) {
    try {
      const { loadConfig } = await import("../config/index.ts");
      cachedConfig = await loadConfig();
    } catch {
      return null;
    }
  }
  return cachedConfig;
}

/**
 * Resolve routing source for a service.
 * Checks the local config's source field, defaults to:
 * - "remote-local" when MCP2CLI_REMOTE_URL is set
 * - "local" when no remote URL
 */
export async function resolveSource(serviceName: string | undefined): Promise<ServiceSource> {
  if (!serviceName) return undefined;
  const config = await getLocalConfig();
  const svc = config?.services[serviceName];
  if (svc?.source) return svc.source;

  if (svc?.platforms && svc.platforms.length > 0) {
    if (svc.platforms.includes(process.platform)) return "local";
    const availability = await getRemoteServiceAvailability(serviceName);
    return availability === "hosted" ? "remote" : "local";
  }

  const availability = await getRemoteServiceAvailability(serviceName);
  if (availability === "hosted") return svc ? undefined : "remote";
  if (svc || availability === "not-hosted") return "local";

  return undefined;
}

async function fetchLocal(
  path: string,
  body?: unknown,
): Promise<DaemonResponse> {
  const paths = getDaemonPaths();
  await ensureDaemon(paths);
  await refreshLocalTokenIfNearExpiry(paths);
  const headers = await buildLocalHeaders();
  const response = await fetch(`http://localhost${path}`, {
    unix: paths.socketPath,
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const localToken = headers.Authorization?.replace(/^Bearer\s+/i, "");
  if (response.status === 401 && localToken && path !== "/api/auth/refresh") {
    const refreshed = await refreshLocalToken(paths, localToken);
    if (refreshed) {
      const retryHeaders = await buildLocalHeaders();
      const retry = await fetch(`http://localhost${path}`, {
        unix: paths.socketPath,
        method: "POST",
        headers: retryHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return (await retry.json()) as DaemonResponse;
    }
  }

  return (await response.json()) as DaemonResponse;
}

const REMOTE_RETRIES = parseInt(process.env.MCP2CLI_REMOTE_RETRIES ?? "3", 10);
const REMOTE_BACKOFF_BASE_MS = parseInt(process.env.MCP2CLI_REMOTE_BACKOFF_MS ?? "500", 10);

async function fetchRemote(
  path: string,
  body?: unknown,
): Promise<DaemonResponse> {
  const remote = getRemoteConfig()!;
  const url = `${remote.url.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (remote.token) {
    headers["Authorization"] = `Bearer ${remote.token}`;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < REMOTE_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REMOTE_CONNECT_TIMEOUT_MS),
      });

      // Auth errors are permanent -- don't retry (wrong token won't become right)
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Remote auth failed (${response.status})`);
      }

      const result = (await response.json()) as DaemonResponse;

      // Application-level connection errors should trigger fallback
      if (!result.success && result.error?.code === "CONNECTION_ERROR") {
        throw new Error(result.error.message);
      }

      return result;
    } catch (err) {
      // Auth errors are permanent -- bail immediately, don't retry
      if (err instanceof Error && err.message.startsWith("Remote auth failed")) {
        throw err;
      }
      lastError = err;
      if (attempt < REMOTE_RETRIES - 1) {
        const delay = REMOTE_BACKOFF_BASE_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Shared fetch helper with per-service routing.
 * Routes based on explicit source, platform support, and remote discovery.
 * Missing local services are remote only when discovery positively hosts them.
 * Platform-disallowed services use remote only when hosted remotely.
 * "remote-local" falls back to local for connection failures, but never for
 * remote auth failures.
 */
async function fetchDaemon(
  path: string,
  body?: unknown,
): Promise<DaemonResponse> {
  const serviceName = body && typeof body === "object" && "service" in body
    ? (body as { service: string }).service
    : undefined;

  const remote = getRemoteConfig();
  const explicitSource = await resolveSource(serviceName);
  const source = explicitSource ?? (remote ? "remote-local" : "local");

  try {
    if (source === "local" || !remote) {
      return await fetchLocal(path, body);
    }

    if (source === "remote") {
      return await fetchRemote(path, body);
    }

    // "remote-local": try remote, fall back to local
    try {
      return await fetchRemote(path, body);
    } catch (err) {
      if (isRemoteAuthError(err)) {
        throw err;
      }
      if (serviceName && await isIdentitySensitiveService(serviceName)) {
        throw err;
      }
      return await fetchLocal(path, body);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const target = source === "local" ? "local daemon" : remote ? `remote daemon at ${remote.url}` : "daemon";
    return {
      success: false,
      error: {
        code: "CONNECTION_ERROR",
        message: `Failed to communicate with ${target}: ${message}`,
      },
    };
  }
}

function isRemoteAuthError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("Remote auth failed");
}

async function isIdentitySensitiveService(serviceName: string): Promise<boolean> {
  try {
    const config = await getLocalConfig();
    if (!config) {
      return false;
    }
    return config.services[serviceName]?.requiresCredentials === true;
  } catch {
    return false;
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

/**
 * Generic daemon API call supporting any HTTP method and path.
 * Used by CLI commands for management endpoints (credentials, etc.).
 * Always routes to local daemon (management APIs are local-only).
 */
export async function fetchDaemonApi(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const paths = getDaemonPaths();
  await ensureDaemon(paths);
  await refreshLocalTokenIfNearExpiry(paths);
  const headers = await buildLocalHeaders();
  const response = await fetch(`http://localhost${path}`, {
    unix: paths.socketPath,
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const localToken = headers.Authorization?.replace(/^Bearer\s+/i, "");
  if (response.status === 401 && localToken && path !== "/api/auth/refresh") {
    const refreshed = await refreshLocalToken(paths, localToken);
    if (refreshed) {
      const retryHeaders = await buildLocalHeaders();
      const retry = await fetch(`http://localhost${path}`, {
        unix: paths.socketPath,
        method,
        headers: retryHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return await retry.json();
    }
  }

  return await response.json();
}
