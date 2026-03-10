import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TokenAuthProvider,
  hasPermission,
  type TokenEntry,
} from "../../src/daemon/auth-provider.ts";
import { authenticateRequest, checkPermission } from "../../src/daemon/auth.ts";

function makeReq(path: string, method = "GET", token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new Request(`http://localhost${path}`, { method, headers });
}

const ADMIN_TOKEN: TokenEntry = { id: "rico", token: "admin-secret", role: "admin" };
const AGENT_TOKEN: TokenEntry = { id: "skippy", token: "agent-secret", role: "agent" };
const ADMIN_WITH_LOGIN: TokenEntry = {
  id: "rico", token: "admin-secret", role: "admin",
  username: "rico", password: "s3cret-pass!",
};
const AGENT_WITH_LOGIN: TokenEntry = {
  id: "skippy", token: "agent-secret", role: "agent",
  username: "skippy", password: "agent-pass-42",
};

describe("TokenAuthProvider", () => {
  test("authenticates valid admin token", () => {
    const provider = new TokenAuthProvider([ADMIN_TOKEN]);
    const ctx = provider.authenticate(makeReq("/call", "POST", "admin-secret"));
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe("rico");
    expect(ctx!.role).toBe("admin");
  });

  test("authenticates valid agent token", () => {
    const provider = new TokenAuthProvider([ADMIN_TOKEN, AGENT_TOKEN]);
    const ctx = provider.authenticate(makeReq("/call", "POST", "agent-secret"));
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe("skippy");
    expect(ctx!.role).toBe("agent");
  });

  test("returns null for invalid token", () => {
    const provider = new TokenAuthProvider([ADMIN_TOKEN]);
    const ctx = provider.authenticate(makeReq("/call", "POST", "wrong-token"));
    expect(ctx).toBeNull();
  });

  test("returns null for missing auth header", () => {
    const provider = new TokenAuthProvider([ADMIN_TOKEN]);
    const ctx = provider.authenticate(makeReq("/call", "POST"));
    expect(ctx).toBeNull();
  });

  test("returns null for malformed auth header", () => {
    const provider = new TokenAuthProvider([ADMIN_TOKEN]);
    const req = new Request("http://localhost/call", {
      method: "POST",
      headers: { Authorization: "Basic abc" },
    });
    expect(provider.authenticate(req)).toBeNull();
  });

  test("enabled is false with no tokens", () => {
    const provider = new TokenAuthProvider([]);
    expect(provider.enabled).toBe(false);
  });

  test("enabled is true with tokens", () => {
    const provider = new TokenAuthProvider([ADMIN_TOKEN]);
    expect(provider.enabled).toBe(true);
  });

  test("fromEnvToken creates admin provider", () => {
    const provider = TokenAuthProvider.fromEnvToken("my-secret");
    const ctx = provider.authenticate(makeReq("/call", "POST", "my-secret"));
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe("default");
    expect(ctx!.role).toBe("admin");
  });

  test("case-insensitive Bearer prefix", () => {
    const provider = new TokenAuthProvider([ADMIN_TOKEN]);
    const req = new Request("http://localhost/call", {
      method: "POST",
      headers: { Authorization: "bearer admin-secret" },
    });
    expect(provider.authenticate(req)).not.toBeNull();
  });
});

describe("TokenAuthProvider.authenticateBasic", () => {
  test("authenticates valid username+password and returns token", () => {
    const provider = new TokenAuthProvider([ADMIN_WITH_LOGIN, AGENT_WITH_LOGIN]);
    const result = provider.authenticateBasic("rico", "s3cret-pass!");
    expect(result).not.toBeNull();
    expect(result!.ctx.userId).toBe("rico");
    expect(result!.ctx.role).toBe("admin");
    expect(result!.token).toBe("admin-secret");
  });

  test("authenticates agent user", () => {
    const provider = new TokenAuthProvider([ADMIN_WITH_LOGIN, AGENT_WITH_LOGIN]);
    const result = provider.authenticateBasic("skippy", "agent-pass-42");
    expect(result).not.toBeNull();
    expect(result!.ctx.userId).toBe("skippy");
    expect(result!.ctx.role).toBe("agent");
    expect(result!.token).toBe("agent-secret");
  });

  test("returns null for wrong password", () => {
    const provider = new TokenAuthProvider([ADMIN_WITH_LOGIN]);
    const result = provider.authenticateBasic("rico", "wrong-password");
    expect(result).toBeNull();
  });

  test("returns null for wrong username", () => {
    const provider = new TokenAuthProvider([ADMIN_WITH_LOGIN]);
    const result = provider.authenticateBasic("nobody", "s3cret-pass!");
    expect(result).toBeNull();
  });

  test("returns null for empty credentials", () => {
    const provider = new TokenAuthProvider([ADMIN_WITH_LOGIN]);
    expect(provider.authenticateBasic("", "")).toBeNull();
    expect(provider.authenticateBasic("rico", "")).toBeNull();
    expect(provider.authenticateBasic("", "s3cret-pass!")).toBeNull();
  });

  test("ignores entries without username/password", () => {
    const provider = new TokenAuthProvider([ADMIN_TOKEN]); // no username/password
    const result = provider.authenticateBasic("rico", "admin-secret");
    expect(result).toBeNull();
  });

  test("mixed entries: login only works for entries with credentials", () => {
    const provider = new TokenAuthProvider([ADMIN_TOKEN, AGENT_WITH_LOGIN]);
    // Token-only entry: no basic auth
    expect(provider.authenticateBasic("rico", "admin-secret")).toBeNull();
    // Entry with login credentials: basic auth works
    const result = provider.authenticateBasic("skippy", "agent-pass-42");
    expect(result).not.toBeNull();
    expect(result!.ctx.userId).toBe("skippy");
  });
});

describe("TokenAuthProvider.load", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-auth-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    delete process.env.MCP2CLI_TOKENS_FILE;
    delete process.env.MCP2CLI_AUTH_TOKEN;
  });

  test("loads from tokens.json file", async () => {
    const tokensPath = join(tmpDir, "tokens.json");
    await Bun.write(tokensPath, JSON.stringify({
      tokens: [
        { id: "rico", token: "t1", role: "admin" },
        { id: "skippy", token: "t2", role: "agent" },
      ],
    }));
    process.env.MCP2CLI_TOKENS_FILE = tokensPath;
    const provider = await TokenAuthProvider.load();
    expect(provider.enabled).toBe(true);
    expect(provider.authenticate(makeReq("/", "GET", "t1"))?.role).toBe("admin");
    expect(provider.authenticate(makeReq("/", "GET", "t2"))?.role).toBe("agent");
  });

  test("falls back to MCP2CLI_AUTH_TOKEN", async () => {
    process.env.MCP2CLI_TOKENS_FILE = join(tmpDir, "nonexistent.json");
    process.env.MCP2CLI_AUTH_TOKEN = "legacy-token";
    const provider = await TokenAuthProvider.load();
    expect(provider.enabled).toBe(true);
    const ctx = provider.authenticate(makeReq("/", "GET", "legacy-token"));
    expect(ctx?.userId).toBe("default");
    expect(ctx?.role).toBe("admin");
  });

  test("returns disabled provider when nothing configured", async () => {
    process.env.MCP2CLI_TOKENS_FILE = join(tmpDir, "nonexistent.json");
    delete process.env.MCP2CLI_AUTH_TOKEN;
    const provider = await TokenAuthProvider.load();
    expect(provider.enabled).toBe(false);
  });

  test("rejects invalid tokens.json", async () => {
    const tokensPath = join(tmpDir, "tokens.json");
    await Bun.write(tokensPath, JSON.stringify({ tokens: [{ id: "x" }] }));
    process.env.MCP2CLI_TOKENS_FILE = tokensPath;
    expect(TokenAuthProvider.load()).rejects.toThrow();
  });

  test("rejects duplicate token ids", async () => {
    const tokensPath = join(tmpDir, "tokens.json");
    await Bun.write(tokensPath, JSON.stringify({
      tokens: [
        { id: "same", token: "t1", role: "admin" },
        { id: "same", token: "t2", role: "agent" },
      ],
    }));
    process.env.MCP2CLI_TOKENS_FILE = tokensPath;
    expect(TokenAuthProvider.load()).rejects.toThrow("Duplicate token id");
  });

  test("loads entries with username/password", async () => {
    const tokensPath = join(tmpDir, "tokens.json");
    await Bun.write(tokensPath, JSON.stringify({
      tokens: [
        { id: "rico", token: "t1", role: "admin", username: "rico", password: "pass1" },
      ],
    }));
    process.env.MCP2CLI_TOKENS_FILE = tokensPath;
    const provider = await TokenAuthProvider.load();
    const result = provider.authenticateBasic("rico", "pass1");
    expect(result).not.toBeNull();
    expect(result!.ctx.userId).toBe("rico");
    expect(result!.token).toBe("t1");
  });

  test("rejects username without password", async () => {
    const tokensPath = join(tmpDir, "tokens.json");
    await Bun.write(tokensPath, JSON.stringify({
      tokens: [{ id: "x", token: "t", role: "admin", username: "x" }],
    }));
    process.env.MCP2CLI_TOKENS_FILE = tokensPath;
    expect(TokenAuthProvider.load()).rejects.toThrow("username without password");
  });

  test("rejects invalid role", async () => {
    const tokensPath = join(tmpDir, "tokens.json");
    await Bun.write(tokensPath, JSON.stringify({
      tokens: [{ id: "x", token: "t", role: "superadmin" }],
    }));
    process.env.MCP2CLI_TOKENS_FILE = tokensPath;
    expect(TokenAuthProvider.load()).rejects.toThrow("invalid role");
  });
});

describe("hasPermission", () => {
  test("admin has all permissions", () => {
    expect(hasPermission("admin", "add")).toBe(true);
    expect(hasPermission("admin", "remove")).toBe(true);
    expect(hasPermission("admin", "import")).toBe(true);
    expect(hasPermission("admin", "shutdown")).toBe(true);
    expect(hasPermission("admin", "call")).toBe(true);
    expect(hasPermission("admin", "list")).toBe(true);
  });

  test("agent can call tools and list but not mutate config", () => {
    expect(hasPermission("agent", "call")).toBe(true);
    expect(hasPermission("agent", "list")).toBe(true);
    expect(hasPermission("agent", "list-tools")).toBe(true);
    expect(hasPermission("agent", "schema")).toBe(true);
    expect(hasPermission("agent", "status")).toBe(true);
    expect(hasPermission("agent", "add")).toBe(false);
    expect(hasPermission("agent", "remove")).toBe(false);
    expect(hasPermission("agent", "import")).toBe(false);
    expect(hasPermission("agent", "reload")).toBe(false);
    expect(hasPermission("agent", "shutdown")).toBe(false);
  });

  test("viewer can only list and check status", () => {
    expect(hasPermission("viewer", "list")).toBe(true);
    expect(hasPermission("viewer", "status")).toBe(true);
    expect(hasPermission("viewer", "call")).toBe(false);
    expect(hasPermission("viewer", "add")).toBe(false);
    expect(hasPermission("viewer", "shutdown")).toBe(false);
  });
});

describe("authenticateRequest", () => {
  test("returns admin context when provider is disabled", () => {
    const provider = new TokenAuthProvider([]);
    const ctx = authenticateRequest(makeReq("/call", "POST"), provider);
    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("admin");
    expect(ctx!.userId).toBe("anonymous");
  });

  test("returns context for valid token", () => {
    const provider = new TokenAuthProvider([AGENT_TOKEN]);
    const ctx = authenticateRequest(makeReq("/call", "POST", "agent-secret"), provider);
    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("agent");
  });

  test("returns null for invalid token", () => {
    const provider = new TokenAuthProvider([ADMIN_TOKEN]);
    const ctx = authenticateRequest(makeReq("/call", "POST", "wrong"), provider);
    expect(ctx).toBeNull();
  });
});

describe("checkPermission", () => {
  test("admin can access all routes", () => {
    const admin = { userId: "rico", role: "admin" as const };
    expect(checkPermission(makeReq("/api/services", "GET"), admin)).toBeNull();
    expect(checkPermission(makeReq("/api/services", "POST"), admin)).toBeNull();
    expect(checkPermission(makeReq("/api/services/foo", "DELETE"), admin)).toBeNull();
    expect(checkPermission(makeReq("/api/services/import", "POST"), admin)).toBeNull();
    expect(checkPermission(makeReq("/shutdown", "POST"), admin)).toBeNull();
  });

  test("agent can list and call but not mutate", () => {
    const agent = { userId: "skippy", role: "agent" as const };
    expect(checkPermission(makeReq("/api/services", "GET"), agent)).toBeNull();
    expect(checkPermission(makeReq("/call", "POST"), agent)).toBeNull();
    expect(checkPermission(makeReq("/list-tools", "POST"), agent)).toBeNull();
    expect(checkPermission(makeReq("/api/services", "POST"), agent)).toBe("add");
    expect(checkPermission(makeReq("/api/services/foo", "DELETE"), agent)).toBe("remove");
    expect(checkPermission(makeReq("/api/services/import", "POST"), agent)).toBe("import");
    expect(checkPermission(makeReq("/shutdown", "POST"), agent)).toBe("shutdown");
  });

  test("viewer can only list and status", () => {
    const viewer = { userId: "v", role: "viewer" as const };
    expect(checkPermission(makeReq("/api/services", "GET"), viewer)).toBeNull();
    expect(checkPermission(makeReq("/api/services/foo/status", "GET"), viewer)).toBeNull();
    expect(checkPermission(makeReq("/call", "POST"), viewer)).toBe("call");
    expect(checkPermission(makeReq("/api/services", "POST"), viewer)).toBe("add");
  });
});
