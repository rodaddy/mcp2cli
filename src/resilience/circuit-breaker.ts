/**
 * Circuit breaker for HTTP gateway connections.
 * Tracks consecutive failures per service and opens the circuit after threshold.
 * State is disk-persisted so rapid successive CLI invocations share state.
 *
 * State machine:
 *   CLOSED  -- normal operation, HTTP attempted first
 *   OPEN    -- HTTP skipped, fallback used directly
 *   HALF-OPEN -- after cooldown, one probe attempt allowed
 *
 * Transitions:
 *   CLOSED  -> OPEN:      failureCount >= threshold
 *   OPEN    -> HALF-OPEN: cooldown period elapsed
 *   HALF-OPEN -> CLOSED:  probe succeeds (recordSuccess)
 *   HALF-OPEN -> OPEN:    probe fails (recordFailure)
 */
import { mkdir, unlink, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createLogger } from "../logger/index.ts";
import type {
  CircuitBreakerConfig,
  CircuitBreakerState,
  CircuitState,
} from "./types.ts";
import { DEFAULT_CIRCUIT_BREAKER_CONFIG } from "./types.ts";

const log = createLogger("circuit-breaker");

const VALID_STATES = new Set(["closed", "open", "half-open"]);

/** Validate service name to prevent path traversal attacks. */
function validateServiceName(service: string): string {
  if (service.includes('/') || service.includes('\\') || service.includes('..')) {
    throw new Error(`Invalid service name: "${service}"`);
  }
  return service;
}

/** Initial state for a service with no prior history. */
function initialState(): CircuitBreakerState {
  return {
    state: "closed",
    failureCount: 0,
    lastFailureAt: null,
    openedAt: null,
    lastSuccessAt: null,
  };
}

/**
 * Resolve the circuit breaker storage directory.
 * Uses MCP2CLI_CACHE_DIR if set, otherwise ~/.cache/mcp2cli/circuit-breaker.
 */
export function getCircuitBreakerDir(): string {
  const cacheBase = process.env.MCP2CLI_CACHE_DIR;
  if (cacheBase) {
    // MCP2CLI_CACHE_DIR points at schemas dir; go up one level for sibling
    return join(dirname(cacheBase), "circuit-breaker");
  }
  const home = process.env.HOME;
  if (!home) {
    throw new Error(
      "Cannot determine circuit breaker path: HOME environment variable is not set",
    );
  }
  return join(home, ".cache", "mcp2cli", "circuit-breaker");
}

/** Get the state file path for a given service. */
export function getStateFilePath(service: string): string {
  validateServiceName(service);
  return join(getCircuitBreakerDir(), `${service}.json`);
}

/**
 * Load persisted circuit breaker state for a service.
 * Returns initial (closed) state if no file exists or file is corrupted.
 */
export async function loadState(
  service: string,
): Promise<CircuitBreakerState> {
  const filePath = getStateFilePath(service);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return initialState();
  }

  try {
    const data = (await file.json()) as CircuitBreakerState;
    // Basic structure validation
    if (
      !data.state ||
      !VALID_STATES.has(data.state) ||
      typeof data.failureCount !== "number" ||
      !Number.isFinite(data.failureCount)
    ) {
      log.warn("corrupt_state", { service, path: filePath });
      return initialState();
    }
    return data;
  } catch {
    log.warn("corrupt_state", { service, path: filePath });
    return initialState();
  }
}

/**
 * Persist circuit breaker state to disk.
 * Uses atomic write (temp + rename) to prevent corruption.
 */
export async function saveState(
  service: string,
  state: CircuitBreakerState,
): Promise<void> {
  const filePath = getStateFilePath(service);
  const dir = dirname(filePath);

  await mkdir(dir, { recursive: true });

  const tempPath = `${filePath}.tmp.${process.pid}`;
  try {
    await Bun.write(tempPath, JSON.stringify(state, null, 2));
    await rename(tempPath, filePath);
    log.debug("state_saved", { service, state: state.state });
  } catch (err) {
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

/**
 * Clear persisted circuit breaker state for a service.
 * Useful for manual reset or testing.
 */
export async function clearState(service: string): Promise<void> {
  const filePath = getStateFilePath(service);
  await unlink(filePath).catch(() => {});
}

/**
 * Determine the effective circuit state, accounting for cooldown transitions.
 * If the circuit is open and cooldown has elapsed, transitions to half-open.
 */
export function resolveState(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
): CircuitState {
  if (state.state !== "open") {
    return state.state;
  }

  // Check if cooldown has elapsed -> transition to half-open
  if (state.openedAt) {
    const openedTime = new Date(state.openedAt).getTime();
    const elapsed = Date.now() - openedTime;
    if (elapsed >= config.cooldownMs) {
      return "half-open";
    }
  }

  return "open";
}

/**
 * Record a connection failure and return the updated state.
 * Transitions closed -> open when threshold is reached.
 * Transitions half-open -> open on probe failure.
 */
// Note: read-modify-write without locking. Concurrent CLI calls may cause
// delayed threshold detection (2N vs N failures). Accepted tradeoff --
// worst case is delayed circuit-open, not data corruption.
export async function recordFailure(
  service: string,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
): Promise<CircuitBreakerState> {
  const state = await loadState(service);
  const now = new Date().toISOString();

  state.failureCount += 1;
  state.lastFailureAt = now;

  const effectiveState = resolveState(state, config);

  if (effectiveState === "half-open") {
    // Probe failed -- reopen circuit
    state.state = "open";
    state.openedAt = now;
    log.warn("circuit_reopened", {
      service,
      failureCount: state.failureCount,
    });
  } else if (
    effectiveState === "closed" &&
    state.failureCount >= config.failureThreshold
  ) {
    // Threshold reached -- open circuit
    state.state = "open";
    state.openedAt = now;
    log.warn("circuit_opened", {
      service,
      failureCount: state.failureCount,
      threshold: config.failureThreshold,
    });
  }

  await saveState(service, state);
  return state;
}

/**
 * Record a successful connection and return the updated state.
 * Resets failure count and closes the circuit.
 */
// Note: read-modify-write without locking. Concurrent CLI calls may cause
// delayed threshold detection (2N vs N failures). Accepted tradeoff --
// worst case is delayed circuit-open, not data corruption.
export async function recordSuccess(
  service: string,
): Promise<CircuitBreakerState> {
  const state = await loadState(service);
  const now = new Date().toISOString();

  const previousState = state.state;
  state.state = "closed";
  state.failureCount = 0;
  state.lastSuccessAt = now;
  state.openedAt = null;

  if (previousState !== "closed") {
    log.info("circuit_closed", { service, previousState });
  }

  await saveState(service, state);
  return state;
}

/**
 * Check whether HTTP should be attempted for this service.
 * Returns true if circuit is closed or half-open (probe allowed).
 * Returns false if circuit is open (skip HTTP, use fallback directly).
 */
export async function shouldAttemptHttp(
  service: string,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
): Promise<boolean> {
  const state = await loadState(service);
  const effective = resolveState(state, config);

  if (effective === "open") {
    log.info("circuit_open_skipping_http", { service });
    return false;
  }

  if (effective === "half-open") {
    log.info("circuit_half_open_probing", { service });
  }

  return true;
}
