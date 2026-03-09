import type { ErrorCode } from "../types/index.ts";

/**
 * Structured error for configuration loading failures.
 * Carries a machine-readable code and optional reason for actionable messages.
 */
export class ConfigError extends Error {
  readonly code: ErrorCode;
  readonly reason?: string;

  constructor(code: ErrorCode, message: string, reason?: string) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
    this.reason = reason;
  }
}
