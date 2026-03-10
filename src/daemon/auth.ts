/**
 * Bearer token authentication for TCP daemon mode.
 * Uses timing-safe comparison to prevent timing attacks.
 * /health is exempt from auth for load balancer probes.
 */
import { createLogger } from "../logger/index.ts";

const log = createLogger("auth");

/** Paths that skip authentication (health checks, metrics scraping) */
const AUTH_EXEMPT_PATHS = new Set(["/health", "/metrics"]);

/**
 * Load the auth token from MCP2CLI_AUTH_TOKEN env var.
 * Returns undefined if not set (auth disabled).
 */
export function loadAuthToken(): string | undefined {
  return process.env.MCP2CLI_AUTH_TOKEN || undefined;
}

/**
 * Check if a request path is exempt from authentication.
 */
export function isAuthExempt(path: string): boolean {
  return AUTH_EXEMPT_PATHS.has(path);
}

/**
 * Validate bearer token from request Authorization header.
 * Returns true if auth is disabled (no token configured) or token matches.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function checkAuth(req: Request, expectedToken: string | undefined): boolean {
  // No token configured -- auth disabled
  if (!expectedToken) return true;

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    log.warn("auth_missing", { path: new URL(req.url).pathname });
    return false;
  }

  // Extract bearer token
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    log.warn("auth_malformed", { path: new URL(req.url).pathname });
    return false;
  }

  const provided = match[1]!;
  if (!timingSafeEqual(provided, expectedToken)) {
    log.warn("auth_invalid", { path: new URL(req.url).pathname });
    return false;
  }

  return true;
}

/**
 * Timing-safe string comparison.
 * Compares all bytes regardless of where a mismatch occurs.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  // Length difference leaks information, but we still compare all bytes
  // of the longer string to maintain constant time
  const len = Math.max(bufA.length, bufB.length);
  let mismatch = bufA.length !== bufB.length ? 1 : 0;

  for (let i = 0; i < len; i++) {
    mismatch |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }

  return mismatch === 0;
}
