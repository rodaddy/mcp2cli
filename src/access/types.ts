/**
 * Access control types for tool allow/block lists.
 * Used by filter.ts to apply glob-based access policies to tool lists.
 */

/** Access policy for a service -- extracted from service config */
export interface AccessPolicy {
  /** Glob patterns for allowed tools (whitelist). If set, only matching tools pass. */
  allowTools?: string[];
  /** Glob patterns for blocked tools (blacklist). Applied after allowTools. */
  blockTools?: string[];
}

/** Result of checking a single tool against an access policy */
export interface AccessCheckResult {
  /** Whether the tool is allowed */
  allowed: boolean;
  /** Reason for blocking, if blocked */
  reason?: string;
}
