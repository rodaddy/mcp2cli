/**
 * Machine-readable error codes used across CLI and config errors.
 * Compile-time safety -- typos in error codes become type errors.
 */
export type ErrorCode =
  | "CONFIG_NOT_FOUND"
  | "CONFIG_PARSE_ERROR"
  | "CONFIG_VALIDATION_ERROR"
  | "INPUT_VALIDATION_ERROR"
  | "CONNECTION_ERROR"
  | "TOOL_ERROR"
  | "TOOL_TIMEOUT"
  | "UNKNOWN_COMMAND"
  | "INTERNAL_ERROR";

/**
 * Structured CLI error output format.
 * All errors are JSON on stdout -- agents parse stdout, not stderr.
 */
export interface CliError {
  error: true;
  code: ErrorCode;
  message: string;
  reason?: string;
}

/**
 * Command handler function signature.
 * All registered commands conform to this type.
 */
export type CommandHandler = (args: string[]) => Promise<void>;

/**
 * Semantic exit codes per REQUIREMENTS.md CORE-06.
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  VALIDATION: 1,
  INTERNAL: 2,
  AUTH: 3,
  TOOL_ERROR: 4,
  CONNECTION: 5,
  DRY_RUN: 10,
} as const;
