/**
 * Structured logger module.
 * Emits JSON log entries to stderr, keeping stdout clean for agent output.
 *
 * Usage:
 *   import { createLogger } from "../logger/index.ts";
 *   const log = createLogger("my-component");
 *   log.info("started", { port: 8080 });
 *
 * Configure via MCP2CLI_LOG_LEVEL env var: silent | error | warn | info | debug
 * Default: silent (zero noise for agent consumption).
 */
import type { LogLevel, LogEntry, Logger } from "./types.ts";

export type { LogLevel, LogEntry, Logger } from "./types.ts";

/** Numeric priority for each level. Higher = more verbose. */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const VALID_LEVELS = new Set<string>(Object.keys(LEVEL_PRIORITY));

/** Current effective log level -- cached to avoid env lookup on every call. */
let currentLevel: LogLevel | null = null;

/** Read log level from env, validate, cache. */
function resolveLevel(): LogLevel {
  const raw = (process.env.MCP2CLI_LOG_LEVEL ?? "").toLowerCase();
  return VALID_LEVELS.has(raw) ? (raw as LogLevel) : "silent";
}

/**
 * Get the current effective log level.
 * Reads from cache, falling back to env var on first call or after reset.
 */
export function getLogLevel(): LogLevel {
  if (currentLevel === null) {
    currentLevel = resolveLevel();
  }
  return currentLevel;
}

/**
 * Programmatically override the log level.
 * Takes precedence over MCP2CLI_LOG_LEVEL env var.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Reset cached level -- next getLogLevel() re-reads the env var.
 * Primarily for testing.
 */
export function resetLogLevel(): void {
  currentLevel = null;
}

/** Check whether a message at the given level should be emitted. */
function shouldEmit(messageLevel: Exclude<LogLevel, "silent">): boolean {
  return LEVEL_PRIORITY[getLogLevel()] >= LEVEL_PRIORITY[messageLevel];
}

/** Write a log entry to stderr as a single JSON line. */
function emit(entry: LogEntry): void {
  process.stderr.write(JSON.stringify(entry) + "\n");
}

/**
 * Create a logger scoped to a named component.
 * Each method checks the current level before emitting.
 */
export function createLogger(component: string): Logger {
  const write = (
    level: Exclude<LogLevel, "silent">,
    message: string,
    data?: Record<string, unknown>,
  ): void => {
    if (!shouldEmit(level)) return;

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      component,
      message,
    };
    if (data !== undefined) {
      entry.data = data;
    }
    emit(entry);
  };

  return {
    error: (msg, data) => write("error", msg, data),
    warn: (msg, data) => write("warn", msg, data),
    info: (msg, data) => write("info", msg, data),
    debug: (msg, data) => write("debug", msg, data),
  };
}
