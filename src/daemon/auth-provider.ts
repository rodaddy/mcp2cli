/**
 * Pluggable auth provider interface and token-based RBAC implementation.
 * Designed for provider swap: token-based now, OAuth/OIDC later.
 */
import { mkdir, open, rename } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { randomBytes } from "node:crypto";
import { createLogger } from "../logger/index.ts";

const log = createLogger("auth-provider");

// --- Interfaces (stable contract -- providers implement these) ---

export type Role = "admin" | "agent" | "viewer";

export interface AuthContext {
  userId: string;
  role: Role;
}

/**
 * Auth provider interface. Implementations authenticate requests
 * and return an AuthContext or null (unauthorized).
 * Designed for drop-in replacement: TokenAuthProvider now, OAuthProvider later.
 */
export interface AuthProvider {
  /** Authenticate a request. Returns AuthContext if valid, null if not. */
  authenticate(req: Request): AuthContext | null;
  /** Whether auth is enabled (at least one credential configured). */
  readonly enabled: boolean;
}

// --- Role hierarchy and permission checks ---

/** Permissions by role. Higher roles inherit lower permissions. */
const ROLE_PERMISSIONS: Record<Role, Set<string>> = {
  viewer: new Set(["list", "status"]),
  agent: new Set(["list", "status", "call", "list-tools", "schema", "credentials-read"]),
  admin: new Set(["list", "status", "call", "list-tools", "schema", "add", "update", "remove", "reload", "import", "shutdown", "credentials-read", "credentials-write"]),
};

/** Check if a role has a specific permission. */
export function hasPermission(role: Role, permission: string): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

// --- Token config schema ---

export interface TokenEntry {
  id: string;
  token: string;
  role: Role;
  description?: string;
  username?: string;
  password?: string;
  expiresAt?: string;
}

export interface TokensConfig {
  tokens: TokenEntry[];
}

const VALID_ROLES = new Set<string>(["admin", "agent", "viewer"]);

function validateTokensConfig(raw: unknown): TokensConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("Tokens config must be an object");
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.tokens)) {
    throw new Error("Tokens config must have a 'tokens' array");
  }
  const tokens: TokenEntry[] = [];
  const seenIds = new Set<string>();
  const seenTokens = new Set<string>();

  for (const [i, entry] of obj.tokens.entries()) {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Token entry ${i} must be an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || !e.id) {
      throw new Error(`Token entry ${i} missing 'id'`);
    }
    if (typeof e.token !== "string" || !e.token) {
      throw new Error(`Token entry ${i} missing 'token'`);
    }
    if (typeof e.role !== "string" || !VALID_ROLES.has(e.role)) {
      throw new Error(`Token entry ${i} has invalid role '${e.role}' (must be admin, agent, or viewer)`);
    }
    if (seenIds.has(e.id)) {
      throw new Error(`Duplicate token id: ${e.id}`);
    }
    if (seenTokens.has(e.token)) {
      throw new Error(`Duplicate token value for id: ${e.id}`);
    }
    seenIds.add(e.id);
    seenTokens.add(e.token);
    // Validate username/password pairing: if one is set, both must be
    if ((e.username !== undefined) !== (e.password !== undefined)) {
      throw new Error(`Token entry ${i} ('${e.id}') has username without password or vice versa`);
    }
    if (e.username !== undefined && typeof e.username !== "string") {
      throw new Error(`Token entry ${i} ('${e.id}') has non-string username`);
    }
    if (e.password !== undefined && typeof e.password !== "string") {
      throw new Error(`Token entry ${i} ('${e.id}') has non-string password`);
    }
    let expiresAt: string | undefined;
    if (e.expiresAt !== undefined) {
      if (typeof e.expiresAt !== "string" || Number.isNaN(Date.parse(e.expiresAt))) {
        throw new Error(`Token entry ${i} ('${e.id}') has invalid expiresAt`);
      }
      expiresAt = e.expiresAt;
    }

    tokens.push({
      id: e.id,
      token: e.token,
      role: e.role as Role,
      description: typeof e.description === "string" ? e.description : undefined,
      username: typeof e.username === "string" ? e.username : undefined,
      password: typeof e.password === "string" ? e.password : undefined,
      expiresAt,
    });
  }

  return { tokens };
}

// --- TokenAuthProvider implementation ---

/**
 * Token-based auth provider with multi-user RBAC.
 * Supports two modes:
 * 1. Legacy: single MCP2CLI_AUTH_TOKEN env var (treated as admin)
 * 2. Multi-user: tokens.json config file with id/token/role entries
 *
 * Uses timing-safe comparison to prevent timing attacks.
 */
export class TokenAuthProvider implements AuthProvider {
  private tokenMap: Map<string, AuthContext & { expiresAt?: string }>;
  /** Map username -> { password, token, context } for basic auth login */
  private userMap: Map<string, { password: string; token: string; ctx: AuthContext; expiresAt?: string }>;
  private entries: TokenEntry[];
  private readonly tokensPath?: string;
  private refreshQueue: Promise<void> = Promise.resolve();
  enabled: boolean;

  constructor(entries: TokenEntry[], opts: { tokensPath?: string } = {}) {
    this.entries = entries.map((entry) => ({ ...entry }));
    this.tokensPath = opts.tokensPath;
    this.tokenMap = new Map();
    this.userMap = new Map();
    this.enabled = false;
    this.rebuildMaps();
  }

  private rebuildMaps(): void {
    this.tokenMap = new Map();
    this.userMap = new Map();
    for (const entry of this.entries) {
      this.tokenMap.set(entry.token, { userId: entry.id, role: entry.role, expiresAt: entry.expiresAt });
      if (entry.username && entry.password) {
        this.userMap.set(entry.username, {
          password: entry.password,
          token: entry.token,
          ctx: { userId: entry.id, role: entry.role },
          expiresAt: entry.expiresAt,
        });
      }
    }
    this.enabled = this.tokenMap.size > 0;
  }

  get configFilePath(): string | null {
    return this.tokensPath ?? null;
  }

  authenticate(req: Request): AuthContext | null {
    if (!this.enabled) return null;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return null;

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;

    const provided = match[1]!;

    // Timing-safe: check against ALL tokens to prevent timing leaks
    let found: (AuthContext & { expiresAt?: string }) | null = null;
    for (const [token, ctx] of this.tokenMap) {
      if (timingSafeEqual(provided, token)) {
        found = ctx;
      }
    }

    if (!found || isExpired(found.expiresAt)) return null;
    return { userId: found.userId, role: found.role };
  }

  /**
   * Authenticate via username + password (for UI login form).
   * Returns { ctx, token } on success (token is the bearer token for subsequent requests).
   * Uses timing-safe comparison to prevent timing attacks.
   */
  authenticateBasic(username: string, password: string): { ctx: AuthContext; token: string } | null {
    // Timing-safe: always iterate all entries to prevent user-enumeration timing leaks
    let found: { ctx: AuthContext; token: string; expiresAt?: string } | null = null;
    for (const [uname, entry] of this.userMap) {
      const nameMatch = timingSafeEqual(username, uname);
      const passMatch = timingSafeEqual(password, entry.password);
      if (nameMatch && passMatch) {
        found = { ctx: entry.ctx, token: entry.token, expiresAt: entry.expiresAt };
      }
    }
    if (found && isExpired(found.expiresAt)) return null;
    return found;
  }

  async reloadFromDisk(): Promise<void> {
    if (!this.tokensPath) {
      throw new Error("Token provider has no tokens file to reload");
    }
    const raw = await Bun.file(this.tokensPath).json();
    const config = validateTokensConfig(raw);
    this.entries = config.tokens.map((entry) => ({ ...entry }));
    this.rebuildMaps();
  }

  async refreshBearerToken(
    provided: string,
    opts: { now?: Date; refreshWindowMs?: number; ttlMs?: number } = {},
  ): Promise<
    | { ok: true; token: string; expiresAt: string; userId: string; role: Role }
    | { ok: false; status: number; message: string }
  > {
    return this.withRefreshLock(async () => {
      if (!this.tokensPath) {
        return { ok: false, status: 501, message: "Token refresh requires a tokens.json provider" };
      }

      await this.reloadFromDisk();
      const now = opts.now ?? new Date();
      const refreshWindowMs = opts.refreshWindowMs ?? resolveDurationEnv("MCP2CLI_TOKEN_REFRESH_WINDOW_MS", 24 * 60 * 60 * 1000);
      const ttlMs = opts.ttlMs ?? resolveDurationEnv("MCP2CLI_TOKEN_TTL_MS", 30 * 24 * 60 * 60 * 1000);
      let matchIndex = -1;

      for (const [index, entry] of this.entries.entries()) {
        if (timingSafeEqual(provided, entry.token)) {
          matchIndex = index;
        }
      }

      if (matchIndex < 0) {
        return { ok: false, status: 401, message: "Invalid token" };
      }

      const entry = this.entries[matchIndex]!;
      if (!entry.expiresAt) {
        return { ok: false, status: 400, message: "Token has no expiry and is not refreshable" };
      }
      const expiresAtMs = Date.parse(entry.expiresAt);
      if (expiresAtMs <= now.getTime()) {
        return { ok: false, status: 401, message: "Token is expired" };
      }
      if (expiresAtMs - now.getTime() > refreshWindowMs) {
        return { ok: false, status: 400, message: "Token is not near expiry" };
      }

      const token = `mcp2cli_${randomBytes(32).toString("base64url")}`;
      const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
      this.entries[matchIndex] = { ...entry, token, expiresAt };
      await this.persistTokens();
      this.rebuildMaps();

      return { ok: true, token, expiresAt, userId: entry.id, role: entry.role };
    });
  }

  private async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.refreshQueue;
    let release!: () => void;
    this.refreshQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async persistTokens(): Promise<void> {
    if (!this.tokensPath) throw new Error("Token provider has no tokens file to write");
    const dir = dirname(this.tokensPath);
    await mkdir(dir, { recursive: true });
    const tempPath = join(dir, `.${basename(this.tokensPath)}.${process.pid}.${Date.now()}.tmp`);
    const fd = await open(tempPath, "wx", 0o600);
    try {
      await fd.writeFile(JSON.stringify({ tokens: this.entries }, null, 2) + "\n");
      await fd.sync();
    } finally {
      await fd.close();
    }
    await rename(tempPath, this.tokensPath);
  }

  /**
   * Load from legacy single-token env var.
   * The token gets admin role with userId "default".
   */
  static fromEnvToken(token: string): TokenAuthProvider {
    return new TokenAuthProvider([{ id: "default", token, role: "admin" }]);
  }

  /**
   * Load from tokens.json config file.
   * Falls back to legacy MCP2CLI_AUTH_TOKEN if file doesn't exist.
   * Returns a disabled provider if neither is configured.
   */
  static async load(tokensPath?: string): Promise<TokenAuthProvider> {
    // Try tokens.json first
    const path = tokensPath ?? getTokensPath();
    const file = Bun.file(path);
    const exists = await file.exists();

    if (exists) {
      try {
        const raw = await file.json();
        const config = validateTokensConfig(raw);
        log.info("tokens_loaded", { path, count: config.tokens.length });
        return new TokenAuthProvider(config.tokens, { tokensPath: path });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("tokens_load_failed", { path, error: msg });
        throw err;
      }
    }

    // Fall back to legacy single-token env var
    const envToken = process.env.MCP2CLI_AUTH_TOKEN ?? process.env.MCP_TOKEN;
    if (envToken) {
      log.info("using_legacy_token", { source: "MCP2CLI_AUTH_TOKEN" });
      return TokenAuthProvider.fromEnvToken(envToken);
    }

    // No auth configured
    log.warn("no_auth_configured");
    return new TokenAuthProvider([]);
  }
}

/** Resolve tokens config file path. */
function getTokensPath(): string {
  if (process.env.MCP2CLI_TOKENS_FILE) {
    return process.env.MCP2CLI_TOKENS_FILE;
  }
  const home = process.env.HOME ?? "";
  return `${home}/.config/mcp2cli/tokens.json`;
}

function isExpired(expiresAt: string | undefined): boolean {
  return expiresAt !== undefined && Date.parse(expiresAt) <= Date.now();
}

function resolveDurationEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
