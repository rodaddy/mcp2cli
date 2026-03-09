import { describe, test, expect, afterEach } from "bun:test";
import { getDaemonPaths } from "../../src/daemon/paths.ts";

describe("getDaemonPaths", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env.XDG_RUNTIME_DIR = originalEnv.XDG_RUNTIME_DIR;
    process.env.MCP2CLI_PID_FILE = originalEnv.MCP2CLI_PID_FILE;
    process.env.MCP2CLI_SOCKET_PATH = originalEnv.MCP2CLI_SOCKET_PATH;
    process.env.HOME = originalEnv.HOME;
  });

  test("uses runtimeDir override when provided", () => {
    delete process.env.MCP2CLI_PID_FILE;
    delete process.env.MCP2CLI_SOCKET_PATH;

    const paths = getDaemonPaths({ runtimeDir: "/tmp/test-runtime" });
    expect(paths.pidFile).toBe("/tmp/test-runtime/mcp2cli/daemon.pid");
    expect(paths.socketPath).toBe("/tmp/test-runtime/mcp2cli/daemon.sock");
  });

  test("falls back to ~/.config/mcp2cli/run/ when XDG_RUNTIME_DIR unset", () => {
    delete process.env.XDG_RUNTIME_DIR;
    delete process.env.MCP2CLI_PID_FILE;
    delete process.env.MCP2CLI_SOCKET_PATH;
    process.env.HOME = "/home/testuser";

    const paths = getDaemonPaths();
    expect(paths.pidFile).toBe(
      "/home/testuser/.config/mcp2cli/run/daemon.pid",
    );
    expect(paths.socketPath).toBe(
      "/home/testuser/.config/mcp2cli/run/daemon.sock",
    );
  });

  test("PID file path ends with daemon.pid", () => {
    delete process.env.MCP2CLI_PID_FILE;
    delete process.env.MCP2CLI_SOCKET_PATH;

    const paths = getDaemonPaths({ runtimeDir: "/tmp/rt" });
    expect(paths.pidFile.endsWith("daemon.pid")).toBe(true);
  });

  test("socket path ends with daemon.sock", () => {
    delete process.env.MCP2CLI_PID_FILE;
    delete process.env.MCP2CLI_SOCKET_PATH;

    const paths = getDaemonPaths({ runtimeDir: "/tmp/rt" });
    expect(paths.socketPath.endsWith("daemon.sock")).toBe(true);
  });

  test("uses MCP2CLI_PID_FILE env var when set (overrides everything)", () => {
    process.env.MCP2CLI_PID_FILE = "/custom/path/my.pid";

    const paths = getDaemonPaths({ runtimeDir: "/tmp/ignored" });
    expect(paths.pidFile).toBe("/custom/path/my.pid");
  });

  test("uses MCP2CLI_SOCKET_PATH env var when set (overrides everything)", () => {
    process.env.MCP2CLI_SOCKET_PATH = "/custom/path/my.sock";

    const paths = getDaemonPaths({ runtimeDir: "/tmp/ignored" });
    expect(paths.socketPath).toBe("/custom/path/my.sock");
  });
});
