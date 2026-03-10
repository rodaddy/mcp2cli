/**
 * Authentication and authorization for the daemon HTTP server.
 * Supports both legacy single-token and multi-user RBAC via AuthProvider.
 */
import { createLogger } from "../logger/index.ts";
import type { AuthContext, AuthProvider } from "./auth-provider.ts";
import { hasPermission } from "./auth-provider.ts";

const log = createLogger("auth");

/** Paths that skip authentication (health probes, metrics scraping, UI shell) */
const AUTH_EXEMPT_PATHS = new Set(["/health", "/metrics", "/", "/api/auth/login"]);

/**
 * Load the auth token from MCP2CLI_AUTH_TOKEN env var.
 * Returns undefined if not set (auth disabled).
 * @deprecated Use TokenAuthProvider.load() for multi-user support.
 */
export function loadAuthToken(): string | undefined {
  return process.env.MCP2CLI_AUTH_TOKEN || undefined;
}

/**
 * Check if a request path is exempt from authentication.
 * Exempt: /health, /metrics, / (UI HTML shell).
 * All /api/* and tool endpoints require bearer token.
 */
export function isAuthExempt(path: string): boolean {
  return AUTH_EXEMPT_PATHS.has(path);
}

/**
 * Legacy auth check -- validates bearer token against a single expected value.
 * @deprecated Use authenticateRequest() with AuthProvider for RBAC.
 */
export function checkAuth(req: Request, expectedToken: string | undefined): boolean {
  if (!expectedToken) return true;

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    log.warn("auth_missing", { path: new URL(req.url).pathname });
    return false;
  }

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

// --- Provider-aware auth (new) ---

/**
 * Authenticate a request using the pluggable AuthProvider.
 * Returns AuthContext if authenticated, null if not.
 * When provider is disabled (no credentials configured), returns a default admin context.
 */
export function authenticateRequest(req: Request, provider: AuthProvider): AuthContext | null {
  if (!provider.enabled) {
    // No auth configured -- allow all as admin (backward compat)
    return { userId: "anonymous", role: "admin" };
  }

  const ctx = provider.authenticate(req);
  if (!ctx) {
    log.warn("auth_failed", { path: new URL(req.url).pathname });
  }
  return ctx;
}

/** Map request paths to permission names for RBAC checks. */
const PATH_PERMISSIONS: Array<{ pattern: RegExp; method: string; permission: string }> = [
  // Tool endpoints
  { pattern: /^\/call$/, method: "POST", permission: "call" },
  { pattern: /^\/list-tools$/, method: "POST", permission: "list-tools" },
  { pattern: /^\/schema$/, method: "POST", permission: "schema" },
  { pattern: /^\/shutdown$/, method: "POST", permission: "shutdown" },
  // Management API
  { pattern: /^\/api\/services$/, method: "GET", permission: "list" },
  { pattern: /^\/api\/services$/, method: "POST", permission: "add" },
  { pattern: /^\/api\/services\/reload$/, method: "POST", permission: "reload" },
  { pattern: /^\/api\/services\/import$/, method: "POST", permission: "import" },
  { pattern: /^\/api\/services\/[^/]+$/, method: "PUT", permission: "update" },
  { pattern: /^\/api\/services\/[^/]+$/, method: "DELETE", permission: "remove" },
  { pattern: /^\/api\/services\/[^/]+\/status$/, method: "GET", permission: "status" },
];

/**
 * Check if an authenticated user has permission for a given request.
 * Returns the required permission name if denied, null if allowed.
 */
export function checkPermission(req: Request, ctx: AuthContext): string | null {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  for (const rule of PATH_PERMISSIONS) {
    if (rule.method === method && rule.pattern.test(path)) {
      if (!hasPermission(ctx.role, rule.permission)) {
        log.warn("permission_denied", { userId: ctx.userId, role: ctx.role, permission: rule.permission, path });
        return rule.permission;
      }
      return null;
    }
  }

  // No matching rule -- allow by default (path exemption already handled upstream)
  return null;
}

/** Timing-safe string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  const len = Math.max(bufA.length, bufB.length);
  let mismatch = bufA.length !== bufB.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    mismatch |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return mismatch === 0;
}
