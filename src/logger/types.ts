/**
 * Logger type definitions.
 * Shared types for the structured logging module.
 */

/** Supported log levels, ordered by verbosity. */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

/** A single structured log entry emitted to stderr as JSON. */
export interface LogEntry {
  level: Exclude<LogLevel, "silent">;
  timestamp: string;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

/** Logger instance scoped to a component. */
export interface Logger {
  error(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}
