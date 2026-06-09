import { describe, test, expect } from "bun:test";
import {
  CredentialsConfigSchema,
  ServiceCredentialSchema,
} from "../../src/credentials/schema.ts";

describe("ServiceCredentialSchema", () => {
  test("accepts headers only", () => {
    const result = ServiceCredentialSchema.safeParse({
      headers: { Authorization: "Bearer abc" },
    });
    expect(result.success).toBe(true);
  });

  test("accepts env only", () => {
    const result = ServiceCredentialSchema.safeParse({
      env: { API_KEY: "secret" },
    });
    expect(result.success).toBe(true);
  });

  test("accepts both headers and env", () => {
    const result = ServiceCredentialSchema.safeParse({
      headers: { Authorization: "Bearer abc" },
      env: { API_KEY: "secret" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty object (no headers or env)", () => {
    const result = ServiceCredentialSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("rejects non-string header values", () => {
    const result = ServiceCredentialSchema.safeParse({
      headers: { Authorization: 123 },
    });
    expect(result.success).toBe(false);
  });

  test("rejects non-string env values", () => {
    const result = ServiceCredentialSchema.safeParse({
      env: { API_KEY: true },
    });
    expect(result.success).toBe(false);
  });

  test("rejects dangerous header names", () => {
    expect(ServiceCredentialSchema.safeParse({ headers: { Host: "evil.com" } }).success).toBe(false);
    expect(ServiceCredentialSchema.safeParse({ headers: { "Transfer-Encoding": "chunked" } }).success).toBe(false);
    expect(ServiceCredentialSchema.safeParse({ headers: { "content-length": "0" } }).success).toBe(false);
  });

  test("rejects reserved object keys in headers and env", () => {
    expect(ServiceCredentialSchema.safeParse({
      headers: Object.fromEntries([["__proto__", "bad"]]),
    }).success).toBe(false);
    expect(ServiceCredentialSchema.safeParse({
      env: Object.fromEntries([["constructor", "bad"]]),
    }).success).toBe(false);
  });

  test("rejects CRLF in header values", () => {
    expect(ServiceCredentialSchema.safeParse({ headers: { "X-Custom": "value\r\nInjected: true" } }).success).toBe(false);
    expect(ServiceCredentialSchema.safeParse({ headers: { "X-Custom": "value\nInjected: true" } }).success).toBe(false);
  });

  test("rejects dangerous env var names", () => {
    expect(ServiceCredentialSchema.safeParse({ env: { PATH: "/evil" } }).success).toBe(false);
    expect(ServiceCredentialSchema.safeParse({ env: { LD_PRELOAD: "/evil.so" } }).success).toBe(false);
    expect(ServiceCredentialSchema.safeParse({ env: { NODE_OPTIONS: "--require /evil" } }).success).toBe(false);
    expect(ServiceCredentialSchema.safeParse({ env: { DYLD_INSERT_LIBRARIES: "/evil.dylib" } }).success).toBe(false);
    expect(ServiceCredentialSchema.safeParse({ env: { MCP2CLI_AUTH_TOKEN: "stolen" } }).success).toBe(false);
    expect(ServiceCredentialSchema.safeParse({ env: { HOME: "/tmp" } }).success).toBe(false);
  });

  test("rejects too many headers", () => {
    const headers: Record<string, string> = {};
    for (let i = 0; i < 51; i++) headers[`X-Header-${i}`] = "value";
    expect(ServiceCredentialSchema.safeParse({ headers }).success).toBe(false);
  });

  test("rejects too many env vars", () => {
    const env: Record<string, string> = {};
    for (let i = 0; i < 51; i++) env[`CUSTOM_VAR_${i}`] = "value";
    expect(ServiceCredentialSchema.safeParse({ env }).success).toBe(false);
  });
});

describe("CredentialsConfigSchema", () => {
  test("accepts valid full config", () => {
    const result = CredentialsConfigSchema.safeParse({
      groups: {
        ai_agents: ["skippy", "bilby", "nagatha"],
      },
      credentials: {
        rico: {
          "open-brain": { headers: { Authorization: "Bearer rico-key" } },
        },
        ai_agents: {
          "open-brain": { headers: { Authorization: "Bearer agent-key" } },
        },
      },
      defaults: {
        proxmox: { headers: { Authorization: "PVEAPIToken=shared" } },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groups.ai_agents).toEqual(["skippy", "bilby", "nagatha"]);
      expect(result.data.credentials.rico?.["open-brain"]?.headers?.Authorization).toBe("Bearer rico-key");
      expect(result.data.defaults.proxmox?.headers?.Authorization).toBe("PVEAPIToken=shared");
    }
  });

  test("defaults missing fields to empty objects", () => {
    const result = CredentialsConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groups).toEqual({});
      expect(result.data.credentials).toEqual({});
      expect(result.data.defaults).toEqual({});
    }
  });

  test("accepts config with only credentials", () => {
    const result = CredentialsConfigSchema.safeParse({
      credentials: {
        skippy: {
          n8n: { env: { N8N_API_KEY: "skippy-key" } },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts config with only defaults", () => {
    const result = CredentialsConfigSchema.safeParse({
      defaults: {
        n8n: { env: { N8N_API_KEY: "shared-key" } },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts config with only groups", () => {
    const result = CredentialsConfigSchema.safeParse({
      groups: { admins: ["rico"] },
    });
    expect(result.success).toBe(true);
  });

  test("rejects groups with non-array values", () => {
    const result = CredentialsConfigSchema.safeParse({
      groups: { admins: "rico" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects groups with non-string members", () => {
    const result = CredentialsConfigSchema.safeParse({
      groups: { admins: [123] },
    });
    expect(result.success).toBe(false);
  });

  test("rejects reserved object keys in credential config maps", () => {
    expect(CredentialsConfigSchema.safeParse({
      groups: Object.fromEntries([["__proto__", ["alice"]]]),
    }).success).toBe(false);
    expect(CredentialsConfigSchema.safeParse({
      credentials: Object.fromEntries([["constructor", { svc: { headers: { X: "1" } } }]]),
    }).success).toBe(false);
    expect(CredentialsConfigSchema.safeParse({
      defaults: Object.fromEntries([["prototype", { headers: { X: "1" } }]]),
    }).success).toBe(false);
  });

  test("allows credentials keyed by group name", () => {
    const result = CredentialsConfigSchema.safeParse({
      groups: { team: ["alice"] },
      credentials: { team: { svc: { headers: { X: "1" } } } },
    });
    expect(result.success).toBe(true);
  });
});
