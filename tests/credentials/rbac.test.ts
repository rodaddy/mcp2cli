import { describe, test, expect } from "bun:test";
import { hasPermission } from "../../src/daemon/auth-provider.ts";
import { checkPermission } from "../../src/daemon/auth.ts";
import type { AuthContext } from "../../src/daemon/auth-provider.ts";

describe("credential RBAC permissions", () => {
  describe("credentials-read", () => {
    test("viewer cannot read credentials", () => {
      expect(hasPermission("viewer", "credentials-read")).toBe(false);
    });

    test("agent can read credentials", () => {
      expect(hasPermission("agent", "credentials-read")).toBe(true);
    });

    test("admin can read credentials", () => {
      expect(hasPermission("admin", "credentials-read")).toBe(true);
    });
  });

  describe("credentials-write", () => {
    test("viewer cannot write credentials", () => {
      expect(hasPermission("viewer", "credentials-write")).toBe(false);
    });

    test("agent cannot write credentials", () => {
      expect(hasPermission("agent", "credentials-write")).toBe(false);
    });

    test("admin can write credentials", () => {
      expect(hasPermission("admin", "credentials-write")).toBe(true);
    });
  });

  describe("checkPermission path mapping", () => {
    const admin: AuthContext = { userId: "admin-user", role: "admin" };
    const agent: AuthContext = { userId: "agent-user", role: "agent" };
    const viewer: AuthContext = { userId: "viewer-user", role: "viewer" };

    function mockReq(method: string, path: string): Request {
      return new Request(`http://localhost${path}`, { method });
    }

    test("GET /api/credentials maps to credentials-write", () => {
      expect(checkPermission(mockReq("GET", "/api/credentials"), admin)).toBeNull();
      expect(checkPermission(mockReq("GET", "/api/credentials"), agent)).toBe("credentials-write");
      expect(checkPermission(mockReq("GET", "/api/credentials"), viewer)).toBe("credentials-write");
    });

    test("GET /api/credentials/resolve maps to credentials-read", () => {
      expect(checkPermission(mockReq("GET", "/api/credentials/resolve"), agent)).toBeNull();
      expect(checkPermission(mockReq("GET", "/api/credentials/resolve"), viewer)).toBe("credentials-read");
    });

    test("GET /api/credentials/groups maps to credentials-write", () => {
      expect(checkPermission(mockReq("GET", "/api/credentials/groups"), admin)).toBeNull();
      expect(checkPermission(mockReq("GET", "/api/credentials/groups"), agent)).toBe("credentials-write");
      expect(checkPermission(mockReq("GET", "/api/credentials/groups"), viewer)).toBe("credentials-write");
    });

    test("POST /api/credentials maps to credentials-write", () => {
      expect(checkPermission(mockReq("POST", "/api/credentials"), admin)).toBeNull();
      expect(checkPermission(mockReq("POST", "/api/credentials"), agent)).toBe("credentials-write");
    });

    test("DELETE /api/credentials maps to credentials-write", () => {
      expect(checkPermission(mockReq("DELETE", "/api/credentials"), admin)).toBeNull();
      expect(checkPermission(mockReq("DELETE", "/api/credentials"), agent)).toBe("credentials-write");
    });

    test("POST /api/credentials/defaults maps to credentials-write", () => {
      expect(checkPermission(mockReq("POST", "/api/credentials/defaults"), admin)).toBeNull();
      expect(checkPermission(mockReq("POST", "/api/credentials/defaults"), agent)).toBe("credentials-write");
    });

    test("DELETE /api/credentials/defaults maps to credentials-write", () => {
      expect(checkPermission(mockReq("DELETE", "/api/credentials/defaults"), admin)).toBeNull();
      expect(checkPermission(mockReq("DELETE", "/api/credentials/defaults"), agent)).toBe("credentials-write");
    });

    test("POST /api/credentials/groups maps to credentials-write", () => {
      expect(checkPermission(mockReq("POST", "/api/credentials/groups"), admin)).toBeNull();
      expect(checkPermission(mockReq("POST", "/api/credentials/groups"), agent)).toBe("credentials-write");
    });

    test("PUT /api/credentials/groups/:name maps to credentials-write", () => {
      expect(checkPermission(mockReq("PUT", "/api/credentials/groups/admins"), admin)).toBeNull();
      expect(checkPermission(mockReq("PUT", "/api/credentials/groups/admins"), agent)).toBe("credentials-write");
    });

    test("DELETE /api/credentials/groups/:name maps to credentials-write", () => {
      expect(checkPermission(mockReq("DELETE", "/api/credentials/groups/admins"), admin)).toBeNull();
      expect(checkPermission(mockReq("DELETE", "/api/credentials/groups/admins"), agent)).toBe("credentials-write");
    });

    test("POST /api/credentials/reload maps to credentials-write", () => {
      expect(checkPermission(mockReq("POST", "/api/credentials/reload"), admin)).toBeNull();
      expect(checkPermission(mockReq("POST", "/api/credentials/reload"), agent)).toBe("credentials-write");
    });
  });
});
