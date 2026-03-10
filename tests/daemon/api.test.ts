import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigManager } from "../../src/daemon/config-manager.ts";
import type { ServicesConfig } from "../../src/config/index.ts";
import { isAuthExempt } from "../../src/daemon/auth.ts";

const STDIO_SERVICE = {
  backend: "stdio" as const,
  command: "/usr/bin/echo",
  args: ["hello"],
  env: {},
};

function makeConfig(services: Record<string, unknown> = {}): ServicesConfig {
  return { services } as ServicesConfig;
}

describe("Management API auth exemptions", () => {
  test("/ is auth-exempt (UI shell)", () => {
    expect(isAuthExempt("/")).toBe(true);
  });

  test("/health is auth-exempt", () => {
    expect(isAuthExempt("/health")).toBe(true);
  });

  test("/metrics is auth-exempt", () => {
    expect(isAuthExempt("/metrics")).toBe(true);
  });

  test("/api/services requires auth", () => {
    expect(isAuthExempt("/api/services")).toBe(false);
  });

  test("/api/services/import requires auth", () => {
    expect(isAuthExempt("/api/services/import")).toBe(false);
  });

  test("/api/services/myservice/status requires auth", () => {
    expect(isAuthExempt("/api/services/myservice/status")).toBe(false);
  });

  test("/call requires auth", () => {
    expect(isAuthExempt("/call")).toBe(false);
  });

  test("/shutdown requires auth", () => {
    expect(isAuthExempt("/shutdown")).toBe(false);
  });
});

describe("ConfigManager API operations", () => {
  let tmpDir: string;
  let configPath: string;
  let mgr: ConfigManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-api-test-"));
    configPath = join(tmpDir, "services.json");
    const initial = makeConfig({ echo: STDIO_SERVICE });
    await Bun.write(configPath, JSON.stringify(initial, null, 2));
    mgr = new ConfigManager(initial, configPath);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("full CRUD lifecycle", async () => {
    // List: starts with echo
    const initial = mgr.getServices();
    expect(Object.keys(initial.services)).toEqual(["echo"]);

    // Add: new stdio service
    await mgr.addService("cat", {
      backend: "stdio",
      command: "/bin/cat",
      args: [],
      env: {},
    });
    expect(mgr.serviceNames).toContain("cat");
    expect(mgr.serviceNames).toContain("echo");

    // Update: change command
    await mgr.updateService("cat", {
      backend: "stdio",
      command: "/usr/bin/cat",
      args: ["-n"],
      env: {},
    });
    const updated = mgr.getService("cat");
    expect((updated as typeof STDIO_SERVICE).command).toBe("/usr/bin/cat");

    // Remove
    await mgr.removeService("cat");
    expect(mgr.getService("cat")).toBeNull();
    expect(mgr.serviceNames).toEqual(["echo"]);

    // Verify final disk state
    const onDisk = await Bun.file(configPath).json();
    expect(Object.keys(onDisk.services)).toEqual(["echo"]);
  });

  test("add rejects invalid backend", async () => {
    expect(
      mgr.addService("bad", { backend: "ftp", url: "ftp://localhost" }),
    ).rejects.toThrow();
  });

  test("add rejects stdio without command", async () => {
    expect(
      mgr.addService("bad", { backend: "stdio" }),
    ).rejects.toThrow();
  });

  test("add rejects http without url", async () => {
    expect(
      mgr.addService("bad", { backend: "http" }),
    ).rejects.toThrow();
  });

  test("add service with http backend", async () => {
    await mgr.addService("web", {
      backend: "http",
      url: "http://localhost:8080/sse",
      headers: { Authorization: "Bearer test" },
    });
    const svc = mgr.getService("web");
    expect(svc).not.toBeNull();
    expect(svc!.backend).toBe("http");
  });

  test("add service with websocket backend", async () => {
    await mgr.addService("ws", {
      backend: "websocket",
      url: "ws://localhost:9090",
      headers: {},
    });
    const svc = mgr.getService("ws");
    expect(svc).not.toBeNull();
    expect(svc!.backend).toBe("websocket");
  });
});
