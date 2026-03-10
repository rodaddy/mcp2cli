import { describe, test, expect } from "bun:test";
import { checkAuth, isAuthExempt, loadAuthToken } from "../../src/daemon/auth.ts";

function makeReq(path: string, authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader) headers["Authorization"] = authHeader;
  return new Request(`http://localhost${path}`, { headers });
}

describe("auth", () => {
  describe("isAuthExempt", () => {
    test("exempts /health", () => {
      expect(isAuthExempt("/health")).toBe(true);
    });

    test("exempts /metrics", () => {
      expect(isAuthExempt("/metrics")).toBe(true);
    });

    test("does not exempt /call", () => {
      expect(isAuthExempt("/call")).toBe(false);
    });

    test("does not exempt /shutdown", () => {
      expect(isAuthExempt("/shutdown")).toBe(false);
    });
  });

  describe("checkAuth", () => {
    test("returns true when no token configured (auth disabled)", () => {
      expect(checkAuth(makeReq("/call"), undefined)).toBe(true);
    });

    test("returns false when token configured but no header", () => {
      expect(checkAuth(makeReq("/call"), "secret")).toBe(false);
    });

    test("returns false with malformed auth header", () => {
      expect(checkAuth(makeReq("/call", "Basic abc123"), "secret")).toBe(false);
    });

    test("returns false with wrong token", () => {
      expect(checkAuth(makeReq("/call", "Bearer wrong"), "secret")).toBe(false);
    });

    test("returns true with correct token", () => {
      expect(checkAuth(makeReq("/call", "Bearer secret"), "secret")).toBe(true);
    });

    test("case-insensitive Bearer prefix", () => {
      expect(checkAuth(makeReq("/call", "bearer secret"), "secret")).toBe(true);
    });

    test("timing-safe: different lengths still compared", () => {
      // Should not short-circuit on length mismatch
      expect(checkAuth(makeReq("/call", "Bearer ab"), "secret-long-token")).toBe(false);
    });
  });

  describe("loadAuthToken", () => {
    test("returns undefined when env not set", () => {
      const orig = process.env.MCP2CLI_AUTH_TOKEN;
      delete process.env.MCP2CLI_AUTH_TOKEN;
      expect(loadAuthToken()).toBeUndefined();
      if (orig !== undefined) process.env.MCP2CLI_AUTH_TOKEN = orig;
    });

    test("returns token when env is set", () => {
      const orig = process.env.MCP2CLI_AUTH_TOKEN;
      process.env.MCP2CLI_AUTH_TOKEN = "test-token";
      expect(loadAuthToken()).toBe("test-token");
      if (orig !== undefined) {
        process.env.MCP2CLI_AUTH_TOKEN = orig;
      } else {
        delete process.env.MCP2CLI_AUTH_TOKEN;
      }
    });

    test("returns undefined for empty string", () => {
      const orig = process.env.MCP2CLI_AUTH_TOKEN;
      process.env.MCP2CLI_AUTH_TOKEN = "";
      expect(loadAuthToken()).toBeUndefined();
      if (orig !== undefined) {
        process.env.MCP2CLI_AUTH_TOKEN = orig;
      } else {
        delete process.env.MCP2CLI_AUTH_TOKEN;
      }
    });
  });
});
