import { describe, test, expect } from "bun:test";
import {
  StdioServiceSchema,
  HttpServiceSchema,
  ServiceSchema,
  ServicesConfigSchema,
} from "../../src/config/schema.ts";

describe("StdioServiceSchema", () => {
  test("valid stdio service with all fields", () => {
    const result = StdioServiceSchema.safeParse({
      description: "n8n workflow automation",
      backend: "stdio",
      command: "npx",
      args: ["-y", "n8n-mcp"],
      env: { N8N_API_URL: "http://localhost:5678" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backend).toBe("stdio");
      expect(result.data.command).toBe("npx");
      expect(result.data.args).toEqual(["-y", "n8n-mcp"]);
    }
  });

  test("optional description missing passes", () => {
    const result = StdioServiceSchema.safeParse({
      backend: "stdio",
      command: "npx",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
    }
  });

  test("optional args/env missing defaults to empty", () => {
    const result = StdioServiceSchema.safeParse({
      backend: "stdio",
      command: "npx",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.args).toEqual([]);
      expect(result.data.env).toEqual({});
    }
  });

  test("missing command fails", () => {
    const result = StdioServiceSchema.safeParse({
      backend: "stdio",
    });
    expect(result.success).toBe(false);
  });

  test("empty command fails", () => {
    const result = StdioServiceSchema.safeParse({
      backend: "stdio",
      command: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("HttpServiceSchema", () => {
  test("valid http service with all fields", () => {
    const result = HttpServiceSchema.safeParse({
      description: "Vault secrets manager",
      backend: "http",
      url: "http://localhost:3001/mcp",
      headers: { Authorization: "Bearer test-token" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backend).toBe("http");
      expect(result.data.url).toBe("http://localhost:3001/mcp");
    }
  });

  test("optional headers missing defaults to empty", () => {
    const result = HttpServiceSchema.safeParse({
      backend: "http",
      url: "http://localhost:3001/mcp",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headers).toEqual({});
    }
  });

  test("missing url fails", () => {
    const result = HttpServiceSchema.safeParse({
      backend: "http",
    });
    expect(result.success).toBe(false);
  });

  test("invalid url fails", () => {
    const result = HttpServiceSchema.safeParse({
      backend: "http",
      url: "not-a-url",
    });
    expect(result.success).toBe(false);
  });
});

describe("ServiceSchema (discriminated union)", () => {
  test("valid stdio service passes", () => {
    const result = ServiceSchema.safeParse({
      backend: "stdio",
      command: "npx",
    });
    expect(result.success).toBe(true);
  });

  test("valid http service passes", () => {
    const result = ServiceSchema.safeParse({
      backend: "http",
      url: "http://localhost:3001/mcp",
    });
    expect(result.success).toBe(true);
  });

  test("missing backend field fails", () => {
    const result = ServiceSchema.safeParse({
      command: "npx",
      args: ["some-tool"],
    });
    expect(result.success).toBe(false);
  });

  test("unknown backend type fails", () => {
    const result = ServiceSchema.safeParse({
      backend: "grpc",
      endpoint: "localhost:50051",
    });
    expect(result.success).toBe(false);
  });
});

describe("ServicesConfigSchema", () => {
  test("valid single stdio service config passes", () => {
    const result = ServicesConfigSchema.safeParse({
      services: {
        n8n: {
          description: "n8n workflow automation",
          backend: "stdio",
          command: "npx",
          args: ["-y", "n8n-mcp"],
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services.n8n).toBeDefined();
    }
  });

  test("valid mixed services (stdio + http) passes", () => {
    const result = ServicesConfigSchema.safeParse({
      services: {
        n8n: {
          backend: "stdio",
          command: "npx",
          args: ["-y", "n8n-mcp"],
        },
        vault: {
          backend: "http",
          url: "http://localhost:3001/mcp",
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.services)).toEqual(["n8n", "vault"]);
    }
  });

  test("empty services object fails", () => {
    const result = ServicesConfigSchema.safeParse({ services: {} });
    expect(result.success).toBe(false);
  });

  test("missing services key fails", () => {
    const result = ServicesConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("wrong root type (array) fails", () => {
    const result = ServicesConfigSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  test("wrong root type (string) fails", () => {
    const result = ServicesConfigSchema.safeParse("not-an-object");
    expect(result.success).toBe(false);
  });

  test("extra unknown fields are stripped", () => {
    const result = ServicesConfigSchema.safeParse({
      services: {
        n8n: {
          backend: "stdio",
          command: "npx",
          extraField: "should-be-stripped",
        },
      },
      unknownRoot: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        (result.data as Record<string, unknown>).unknownRoot,
      ).toBeUndefined();
    }
  });
});
