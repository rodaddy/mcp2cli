import { describe, test, expect } from "bun:test";
import { mergeCredentials, userPoolKey, applyCallerTemplates } from "../../src/daemon/credential-merge.ts";
import type { CallerContext } from "../../src/daemon/credential-merge.ts";
import type { ServiceConfig } from "../../src/config/index.ts";
import type { ServiceCredential } from "../../src/credentials/index.ts";

describe("mergeCredentials", () => {
  test("merges headers into http service config", () => {
    const service: ServiceConfig = {
      backend: "http",
      url: "http://localhost:3000/mcp",
      headers: { "X-Original": "keep" },
    };
    const cred: ServiceCredential = {
      headers: { Authorization: "Bearer user-key" },
    };
    const result = mergeCredentials(service, cred);
    expect(result).toEqual({
      backend: "http",
      url: "http://localhost:3000/mcp",
      headers: {
        "X-Original": "keep",
        Authorization: "Bearer user-key",
      },
    });
  });

  test("user headers override service headers", () => {
    const service: ServiceConfig = {
      backend: "http",
      url: "http://localhost:3000/mcp",
      headers: { Authorization: "Bearer default" },
    };
    const cred: ServiceCredential = {
      headers: { Authorization: "Bearer override" },
    };
    const result = mergeCredentials(service, cred);
    expect((result as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer override");
  });

  test("creates headers when http service has none", () => {
    const service = {
      backend: "http",
      url: "http://localhost:3000/mcp",
    } as unknown as ServiceConfig;
    const cred: ServiceCredential = {
      headers: { Authorization: "Bearer user-key" },
    };
    const result = mergeCredentials(service, cred);
    expect((result as { headers: Record<string, string> }).headers).toEqual({
      Authorization: "Bearer user-key",
    });
  });

  test("merges env into stdio service config", () => {
    const service: ServiceConfig = {
      backend: "stdio",
      command: "npx",
      args: ["-y", "some-mcp"],
      env: { EXISTING: "keep" },
    };
    const cred: ServiceCredential = {
      env: { API_KEY: "user-key" },
    };
    const result = mergeCredentials(service, cred);
    expect((result as { env: Record<string, string> }).env).toEqual({
      EXISTING: "keep",
      API_KEY: "user-key",
    });
  });

  test("user env overrides service env", () => {
    const service: ServiceConfig = {
      backend: "stdio",
      command: "npx",
      args: [],
      env: { API_KEY: "default" },
    };
    const cred: ServiceCredential = {
      env: { API_KEY: "override" },
    };
    const result = mergeCredentials(service, cred);
    expect((result as { env: Record<string, string> }).env.API_KEY).toBe("override");
  });

  test("creates env when stdio service has none", () => {
    const service = {
      backend: "stdio",
      command: "npx",
      args: ["-y", "some-mcp"],
    } as unknown as ServiceConfig;
    const cred: ServiceCredential = {
      env: { API_KEY: "user-key" },
    };
    const result = mergeCredentials(service, cred);
    expect((result as { env: Record<string, string> }).env).toEqual({
      API_KEY: "user-key",
    });
  });

  test("does not mutate the original service config", () => {
    const service: ServiceConfig = {
      backend: "http",
      url: "http://localhost:3000/mcp",
      headers: { Original: "value" },
    };
    const cred: ServiceCredential = {
      headers: { Added: "new" },
    };
    mergeCredentials(service, cred);
    expect((service as { headers: Record<string, string> }).headers).toEqual({ Original: "value" });
  });

  test("handles credential with no matching fields", () => {
    const service: ServiceConfig = {
      backend: "http",
      url: "http://localhost:3000/mcp",
      headers: { Original: "value" },
    };
    const cred: ServiceCredential = {
      env: { KEY: "val" },
    };
    const result = mergeCredentials(service, cred);
    // env doesn't exist on http service, so it's a no-op
    expect(result).toEqual({
      backend: "http",
      url: "http://localhost:3000/mcp",
      headers: { Original: "value" },
    });
  });

  test("handles websocket service", () => {
    const service: ServiceConfig = {
      backend: "websocket",
      url: "ws://localhost:3000/mcp",
      headers: { "X-Base": "1" },
    };
    const cred: ServiceCredential = {
      headers: { Authorization: "Bearer ws-key" },
    };
    const result = mergeCredentials(service, cred);
    expect((result as { headers: Record<string, string> }).headers).toEqual({
      "X-Base": "1",
      Authorization: "Bearer ws-key",
    });
  });
});

describe("caller template expansion", () => {
  const caller: CallerContext = { id: "bilby", role: "agent" };

  test("expands ${caller.id} in merged headers", () => {
    const service: ServiceConfig = {
      backend: "http",
      url: "http://localhost:3100/mcp",
      headers: { "X-Base": "static" },
    };
    const cred: ServiceCredential = {
      headers: { "X-Agent-Id": "${caller.id}", "X-Role": "${caller.role}" },
    };
    const result = mergeCredentials(service, cred, caller);
    const headers = (result as { headers: Record<string, string> }).headers;
    expect(headers["X-Agent-Id"]).toBe("bilby");
    expect(headers["X-Role"]).toBe("agent");
    expect(headers["X-Base"]).toBe("static");
  });

  test("expands templates in service config headers via applyCallerTemplates", () => {
    const service: ServiceConfig = {
      backend: "http",
      url: "http://localhost:3100/mcp",
      headers: {
        Authorization: "Bearer static-key",
        "X-Namespace": "${caller.id}",
      },
    };
    const result = applyCallerTemplates(service, caller);
    const headers = (result as { headers: Record<string, string> }).headers;
    expect(headers["X-Namespace"]).toBe("bilby");
    expect(headers.Authorization).toBe("Bearer static-key");
  });

  test("expands ${caller.id} in stdio env", () => {
    const service: ServiceConfig = {
      backend: "stdio",
      command: "node",
      args: ["server.js"],
      env: { NAMESPACE: "${caller.id}", STATIC: "keep" },
    };
    const cred: ServiceCredential = {
      env: { AGENT_ROLE: "${caller.role}" },
    };
    const result = mergeCredentials(service, cred, caller);
    const env = (result as { env: Record<string, string> }).env;
    expect(env.NAMESPACE).toBe("bilby");
    expect(env.AGENT_ROLE).toBe("agent");
    expect(env.STATIC).toBe("keep");
  });

  test("leaves unknown template variables unexpanded", () => {
    const service: ServiceConfig = {
      backend: "http",
      url: "http://localhost:3100/mcp",
      headers: { "X-Unknown": "${caller.email}" },
    };
    const result = applyCallerTemplates(service, caller);
    const headers = (result as { headers: Record<string, string> }).headers;
    expect(headers["X-Unknown"]).toBe("${caller.email}");
  });

  test("does not expand templates when no caller context", () => {
    const service: ServiceConfig = {
      backend: "http",
      url: "http://localhost:3100/mcp",
      headers: { "X-Agent-Id": "${caller.id}" },
    };
    const cred: ServiceCredential = { headers: {} };
    const result = mergeCredentials(service, cred);
    const headers = (result as { headers: Record<string, string> }).headers;
    expect(headers["X-Agent-Id"]).toBe("${caller.id}");
  });

  test("handles multiple templates in one value", () => {
    const service: ServiceConfig = {
      backend: "http",
      url: "http://localhost:3100/mcp",
      headers: { "X-Info": "${caller.id}:${caller.role}" },
    };
    const result = applyCallerTemplates(service, caller);
    const headers = (result as { headers: Record<string, string> }).headers;
    expect(headers["X-Info"]).toBe("bilby:agent");
  });

  test("does not mutate original config", () => {
    const service: ServiceConfig = {
      backend: "http",
      url: "http://localhost:3100/mcp",
      headers: { "X-Agent-Id": "${caller.id}" },
    };
    applyCallerTemplates(service, caller);
    expect((service as { headers: Record<string, string> }).headers["X-Agent-Id"]).toBe("${caller.id}");
  });
});

describe("userPoolKey", () => {
  test("returns service name when no userId", () => {
    expect(userPoolKey("open-brain")).toBe("open-brain");
  });

  test("returns service::userId when userId provided", () => {
    expect(userPoolKey("open-brain", "rico")).toMatch(/^credential:/);
  });

  test("returns service name when userId is undefined", () => {
    expect(userPoolKey("n8n", undefined)).toBe("n8n");
  });

  test("credential scoped keys do not collide when components contain delimiters", () => {
    expect(userPoolKey("a", "b::c")).not.toBe(userPoolKey("a::b", "c"));
  });
});
