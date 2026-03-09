import { describe, test, expect, afterEach } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { loadConfig } from "../../src/config/loader.ts";
import { ConfigError } from "../../src/config/errors.ts";

const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures");

afterEach(() => {
  delete process.env.MCP2CLI_CONFIG;
});

describe("loadConfig", () => {
  test("valid config file loads and returns typed ServicesConfig", async () => {
    process.env.MCP2CLI_CONFIG = resolve(FIXTURES_DIR, "valid-config.json");
    const config = await loadConfig();
    expect(config.services).toBeDefined();
    const n8n = config.services["n8n"];
    expect(n8n).toBeDefined();
    expect(n8n!.backend).toBe("stdio");
    if (n8n && n8n.backend === "stdio") {
      expect(n8n.command).toBe("npx");
    }
  });

  test("missing config file throws ConfigError with CONFIG_NOT_FOUND", async () => {
    process.env.MCP2CLI_CONFIG = resolve(
      tmpdir(),
      "nonexistent-mcp2cli-config-12345.json",
    );
    try {
      await loadConfig();
      throw new Error("Expected ConfigError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      if (err instanceof ConfigError) {
        expect(err.code).toBe("CONFIG_NOT_FOUND");
        expect(err.message).toContain("not found");
      }
    }
  });

  test("invalid JSON file throws ConfigError with CONFIG_PARSE_ERROR", async () => {
    process.env.MCP2CLI_CONFIG = resolve(FIXTURES_DIR, "invalid-not-json.txt");
    await expect(loadConfig()).rejects.toThrow(ConfigError);
  });

  test("schema violation throws ConfigError with CONFIG_VALIDATION_ERROR", async () => {
    process.env.MCP2CLI_CONFIG = resolve(
      FIXTURES_DIR,
      "invalid-empty-services.json",
    );
    try {
      await loadConfig();
      throw new Error("Expected ConfigError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      if (err instanceof ConfigError) {
        expect(err.code).toBe("CONFIG_VALIDATION_ERROR");
      }
    }
  });

  test("MCP2CLI_CONFIG env var overrides default path", async () => {
    // Write a temp config file to a custom location
    const customPath = resolve(tmpdir(), `mcp2cli-test-${Date.now()}.json`);
    await Bun.write(
      customPath,
      JSON.stringify({
        services: {
          test: {
            backend: "stdio",
            command: "echo",
            args: ["hello"],
          },
        },
      }),
    );

    process.env.MCP2CLI_CONFIG = customPath;
    const config = await loadConfig();
    const testSvc = config.services["test"];
    expect(testSvc).toBeDefined();
    expect(testSvc!.backend).toBe("stdio");

    // Clean up temp file
    const { unlink } = await import("fs/promises");
    await unlink(customPath).catch(() => {});
  });
});
