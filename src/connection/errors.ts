import type { ErrorCode } from "../types/index.ts";

/**
 * Structured error for MCP connection failures.
 * Carries a CONNECTION_ERROR code typed via ErrorCode and optional reason.
 */
export class ConnectionError extends Error {
  readonly code: ErrorCode;
  readonly reason?: string;

  constructor(message: string, reason?: string) {
    super(message);
    this.name = "ConnectionError";
    this.code = "CONNECTION_ERROR" satisfies ErrorCode;
    this.reason = reason;
  }
}
