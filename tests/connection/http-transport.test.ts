import { describe, test, expect } from "bun:test";
import {
  HttpServiceSchema,
  ServiceSchema,
  ServicesConfigSchema,
} from "../../src/config/schema.ts";

describe("HttpService config validation", () => {
  test("valid HTTP service with url only", () => {
    const result = HttpServiceSchema.safeParse({
      backend: "http",
      url: "http://10.71.20.14:3001/mcp",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backend).toBe("http");
      expect(result.data.url).toBe("http://10.71.20.14:3001/mcp");
      expect(result.data.headers).toEqual({});
    }
  });

  test("valid HTTP service with headers", () => {
    const result = HttpServiceSchema.safeParse({
      backend: "http",
      url: "http://127.0.0.1:9234/mcp",
      headers: { Authorization: "Bearer tok_123" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headers).toEqual({ Authorization: "Bearer tok_123" });
    }
  });

  test("valid HTTP service with description", () => {
    const result = HttpServiceSchema.safeParse({
      backend: "http",
      url: "http://localhost:3001/mcp",
      description: "Vaultwarden secrets",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("Vaultwarden secrets");
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
      url: "not-a-valid-url",
    });
    expect(result.success).toBe(false);
  });

  test("empty string url fails", () => {
    const result = HttpServiceSchema.safeParse({
      backend: "http",
      url: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("ServiceSchema accepts both backends", () => {
  test("stdio service via discriminated union", () => {
    const result = ServiceSchema.safeParse({
      backend: "stdio",
      command: "node",
      args: ["server.js"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backend).toBe("stdio");
    }
  });

  test("http service via discriminated union", () => {
    const result = ServiceSchema.safeParse({
      backend: "http",
      url: "http://localhost:3001/mcp",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backend).toBe("http");
    }
  });

  test("unknown backend fails", () => {
    const result = ServiceSchema.safeParse({
      backend: "grpc",
      endpoint: "localhost:50051",
    });
    expect(result.success).toBe(false);
  });
});

describe("ServicesConfig with mixed backends", () => {
  test("config with stdio + http services", () => {
    const result = ServicesConfigSchema.safeParse({
      services: {
        n8n: {
          backend: "stdio",
          command: "npx",
          args: ["-y", "n8n-mcp"],
        },
        vault: {
          backend: "http",
          url: "http://10.71.20.14:3001/mcp",
          headers: { Authorization: "Bearer tok" },
        },
        homekit: {
          backend: "http",
          url: "http://127.0.0.1:9234/mcp",
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.services)).toHaveLength(3);
      const vault = result.data.services.vault;
      expect(vault).toBeDefined();
      expect(vault!.backend).toBe("http");
      if (vault!.backend === "http") {
        expect(vault!.url).toBe("http://10.71.20.14:3001/mcp");
      }
    }
  });

  test("http-only config is valid", () => {
    const result = ServicesConfigSchema.safeParse({
      services: {
        vault: {
          backend: "http",
          url: "http://10.71.20.14:3001/mcp",
        },
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("HTTP transport module imports", () => {
  test("connectToHttpService is exported from connection index", async () => {
    const mod = await import("../../src/connection/index.ts");
    expect(typeof mod.connectToHttpService).toBe("function");
  });

  test("connectToHttpService function exists in http-transport module", async () => {
    const mod = await import("../../src/connection/http-transport.ts");
    expect(typeof mod.connectToHttpService).toBe("function");
  });
});

describe("Bootstrap converts HTTP entries", () => {
  test("convertEntry handles HTTP type entries", async () => {
    const { convertEntry } = await import(
      "../../src/cli/commands/bootstrap.ts"
    );

    const result = convertEntry("vault", {
      type: "http",
      url: "http://10.71.20.14:3001/mcp",
      headers: { Authorization: "Bearer tok" },
    });

    expect(result.name).toBe("vault");
    expect(result.config).toBeDefined();
    expect(result.config!.backend).toBe("http");
    if (result.config!.backend === "http") {
      expect(result.config!.url).toBe("http://10.71.20.14:3001/mcp");
      expect(result.config!.headers).toEqual({ Authorization: "Bearer tok" });
    }
    expect(result.warning).toBeUndefined();
  });

  test("convertEntry handles SSE type entries", async () => {
    const { convertEntry } = await import(
      "../../src/cli/commands/bootstrap.ts"
    );

    const result = convertEntry("homekit", {
      type: "sse",
      url: "http://127.0.0.1:9234/mcp",
    });

    expect(result.name).toBe("homekit");
    expect(result.config).toBeDefined();
    expect(result.config!.backend).toBe("http");
  });

  test("convertEntry handles url-only entries (no type, no command)", async () => {
    const { convertEntry } = await import(
      "../../src/cli/commands/bootstrap.ts"
    );

    const result = convertEntry("remote", {
      url: "http://gateway.local:8080/mcp",
    });

    expect(result.name).toBe("remote");
    expect(result.config).toBeDefined();
    expect(result.config!.backend).toBe("http");
  });

  test("convertEntry warns on HTTP entry with missing url", async () => {
    const { convertEntry } = await import(
      "../../src/cli/commands/bootstrap.ts"
    );

    const result = convertEntry("bad-http", { type: "http" });
    expect(result.config).toBeUndefined();
    expect(result.warning).toContain("missing url");
  });

  test("stdio entry with url field stays stdio (has command)", async () => {
    const { convertEntry } = await import(
      "../../src/cli/commands/bootstrap.ts"
    );

    // An entry with both command and url should be treated as stdio
    // (the url is just extra metadata)
    const result = convertEntry("hybrid", {
      command: "node",
      args: ["server.js"],
      url: "http://localhost:3000",
    });

    expect(result.config).toBeDefined();
    expect(result.config!.backend).toBe("stdio");
  });
});
