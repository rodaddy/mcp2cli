/**
 * Tool access control filtering.
 * Applies allow/block glob patterns to filter tool lists.
 * Uses simple glob-to-regex conversion -- no external dependencies.
 */
import type { AccessPolicy, AccessCheckResult } from "./types.ts";

const regexCache = new Map<string, RegExp>();

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports: * (match any chars), ? (match single char).
 * All other regex special chars are escaped.
 * Collapses consecutive wildcards to mitigate ReDoS.
 * Caches compiled regexes to avoid recompilation.
 */
export function globToRegex(pattern: string): RegExp {
  const cached = regexCache.get(pattern);
  if (cached) return cached;

  if (pattern.length > 200) {
    throw new Error(`Glob pattern too long (${pattern.length} chars, max 200)`);
  }

  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*+/g, ".*").replace(/\?/g, ".");
  const regex = new RegExp(`^${regexStr}$`);
  regexCache.set(pattern, regex);
  return regex;
}

/**
 * Check whether a tool name matches any pattern in a list.
 */
function matchesAny(toolName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegex(pattern).test(toolName));
}

/**
 * Check a single tool name against an access policy.
 * Returns whether the tool is allowed and, if blocked, the reason.
 *
 * Logic:
 * 1. If allowTools is set and tool doesn't match any allow pattern -> blocked (not in allowlist)
 * 2. If blockTools is set and tool matches any block pattern -> blocked (in blocklist)
 * 3. Otherwise -> allowed
 */
export function checkToolAccess(
  toolName: string,
  policy: AccessPolicy,
): AccessCheckResult {
  // Check allowlist first (if configured)
  if (policy.allowTools && policy.allowTools.length > 0) {
    if (!matchesAny(toolName, policy.allowTools)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is not in the allowTools list for this service`,
      };
    }
  }

  // Check blocklist
  if (policy.blockTools && policy.blockTools.length > 0) {
    if (matchesAny(toolName, policy.blockTools)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is blocked by policy (matches blockTools pattern)`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Filter a list of tool objects by access policy.
 * Returns only tools that pass the allow/block checks.
 * Works with any object that has a `name` property.
 */
export function filterTools<T extends { name: string }>(
  tools: T[],
  policy: AccessPolicy,
): T[] {
  // Fast path: no policy configured
  if (
    (!policy.allowTools || policy.allowTools.length === 0) &&
    (!policy.blockTools || policy.blockTools.length === 0)
  ) {
    return tools;
  }

  return tools.filter((tool) => checkToolAccess(tool.name, policy).allowed);
}

/**
 * Extract an AccessPolicy from a service config object.
 * Works with both StdioService and HttpService configs.
 */
export function extractPolicy(
  serviceConfig: { allowTools?: string[]; blockTools?: string[] },
): AccessPolicy {
  return {
    allowTools: serviceConfig.allowTools,
    blockTools: serviceConfig.blockTools,
  };
}
