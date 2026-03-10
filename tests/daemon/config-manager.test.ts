import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigManager, ConfigManagerError } from "../../src/daemon/config-manager.ts";
import type { ServicesConfig } from "../../src/config/index.ts";

const STDIO_SERVICE = {
  backend: "stdio" as const,
  command: "/usr/bin/echo",
  args: ["hello"],
  env: {},
};

const HTTP_SERVICE = {
  backend: "http" as const,
  url: "http://localhost:3000/sse",
  headers: {},
};

function makeConfig(services: Record<string, unknown> = {}): ServicesConfig {
  return { services } as ServicesConfig;
}

describe("ConfigManager", () => {
  let tmpDir: string;
  let configPath: string;
  let mgr: ConfigManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-test-"));
    configPath = join(tmpDir, "services.json");
    const initial = makeConfig({ echo: STDIO_SERVICE });
    await Bun.write(configPath, JSON.stringify(initial, null, 2));
    mgr = new ConfigManager(initial, configPath);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("getServices", () => {
    test("returns a clone of the config", () => {
      const cfg = mgr.getServices();
      expect(cfg.services.echo).toBeDefined();
      // Mutating the returned object should not affect internal state
      delete cfg.services.echo;
      expect(mgr.getServices().services.echo).toBeDefined();
    });
  });

  describe("getService", () => {
    test("returns service config by name", () => {
      const svc = mgr.getService("echo");
      expect(svc).not.toBeNull();
      expect(svc!.backend).toBe("stdio");
    });

    test("returns null for unknown service", () => {
      expect(mgr.getService("nonexistent")).toBeNull();
    });
  });

  describe("serviceNames", () => {
    test("lists configured service names", () => {
      expect(mgr.serviceNames).toEqual(["echo"]);
    });
  });

  describe("addService", () => {
    test("adds a valid service and persists to disk", async () => {
      await mgr.addService("web", HTTP_SERVICE);
      expect(mgr.getService("web")).not.toBeNull();

      // Verify disk persistence
      const onDisk = await Bun.file(configPath).json();
      expect(onDisk.services.web).toBeDefined();
      expect(onDisk.services.web.backend).toBe("http");
    });

    test("throws on duplicate name", async () => {
      expect(mgr.addService("echo", STDIO_SERVICE)).rejects.toThrow(ConfigManagerError);
    });

    test("throws on invalid config", async () => {
      expect(mgr.addService("bad", { backend: "unknown" })).rejects.toThrow(ConfigManagerError);
    });

    test("throws on missing required fields", async () => {
      expect(mgr.addService("bad", { backend: "stdio" })).rejects.toThrow();
    });
  });

  describe("updateService", () => {
    test("updates an existing service", async () => {
      await mgr.updateService("echo", { ...STDIO_SERVICE, command: "/bin/cat" });
      const svc = mgr.getService("echo");
      expect(svc).not.toBeNull();
      expect((svc as typeof STDIO_SERVICE).command).toBe("/bin/cat");
    });

    test("throws on unknown service", async () => {
      expect(mgr.updateService("nope", STDIO_SERVICE)).rejects.toThrow(ConfigManagerError);
    });
  });

  describe("removeService", () => {
    test("removes a service and persists", async () => {
      // Add a second service first (config requires at least one)
      await mgr.addService("web", HTTP_SERVICE);
      await mgr.removeService("echo");
      expect(mgr.getService("echo")).toBeNull();
      expect(mgr.serviceNames).toEqual(["web"]);

      const onDisk = await Bun.file(configPath).json();
      expect(onDisk.services.echo).toBeUndefined();
    });

    test("throws on unknown service", async () => {
      expect(mgr.removeService("nope")).rejects.toThrow(ConfigManagerError);
    });
  });

  describe("reloadFromDisk", () => {
    test("picks up disk changes", async () => {
      // Write a modified config directly to disk
      const newConfig = makeConfig({
        echo: STDIO_SERVICE,
        web: HTTP_SERVICE,
      });
      await Bun.write(configPath, JSON.stringify(newConfig, null, 2));

      const diff = await mgr.reloadFromDisk();
      expect(diff.added).toEqual(["web"]);
      expect(diff.removed).toEqual([]);
      expect(mgr.serviceNames).toContain("web");
    });

    test("detects removed services", async () => {
      // Add web first, then reload with just echo
      await mgr.addService("web", HTTP_SERVICE);
      const echoOnly = makeConfig({ echo: STDIO_SERVICE });
      await Bun.write(configPath, JSON.stringify(echoOnly, null, 2));

      const diff = await mgr.reloadFromDisk();
      expect(diff.removed).toEqual(["web"]);
    });

    test("throws on missing file", async () => {
      await rm(configPath);
      expect(mgr.reloadFromDisk()).rejects.toThrow(ConfigManagerError);
    });
  });

  describe("buildGitHubRawUrl", () => {
    test("builds from owner/repo", () => {
      const url = ConfigManager.buildGitHubRawUrl("user/repo");
      expect(url).toBe("https://raw.githubusercontent.com/user/repo/main/services.json");
    });

    test("builds with custom branch and path", () => {
      const url = ConfigManager.buildGitHubRawUrl("user/repo", "develop", "config/services.json");
      expect(url).toBe("https://raw.githubusercontent.com/user/repo/develop/config/services.json");
    });

    test("strips full GitHub URL prefix", () => {
      const url = ConfigManager.buildGitHubRawUrl("https://github.com/user/repo.git");
      expect(url).toBe("https://raw.githubusercontent.com/user/repo/main/services.json");
    });
  });
});
