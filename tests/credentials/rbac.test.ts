import { describe, test, expect } from "bun:test";
import { hasPermission } from "../../src/daemon/auth-provider.ts";

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
});
