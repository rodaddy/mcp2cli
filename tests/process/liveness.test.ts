import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isDaemonAlive,
  getDaemonStatus,
  cleanStaleDaemon,
} from "../../src/process/liveness.ts";
import type { DaemonPaths } from "../../src/daemon/types.ts";

describe("isDaemonAlive", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns false when PID file missing", async () => {
    const result = await isDaemonAlive(join(tmpDir, "nonexistent.pid"));
    expect(result).toBe(false);
  });

  test("returns false when PID file contains garbage text", async () => {
    const pidFile = join(tmpDir, "daemon.pid");
    await writeFile(pidFile, "not-a-number\n");
    const result = await isDaemonAlive(pidFile);
    expect(result).toBe(false);
  });

  test("returns false when PID file has dead process PID", async () => {
    const pidFile = join(tmpDir, "daemon.pid");
    // PID 99999 is very unlikely to be running
    await writeFile(pidFile, "99999\n");
    const result = await isDaemonAlive(pidFile);
    expect(result).toBe(false);
  });

  test("returns true for current process PID", async () => {
    const pidFile = join(tmpDir, "daemon.pid");
    await writeFile(pidFile, `${process.pid}\n`);
    const result = await isDaemonAlive(pidFile);
    expect(result).toBe(true);
  });
});

describe("getDaemonStatus", () => {
  let tmpDir: string;
  let paths: DaemonPaths;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-test-"));
    paths = {
      pidFile: join(tmpDir, "daemon.pid"),
      socketPath: join(tmpDir, "daemon.sock"),
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('returns "stopped" when no PID file exists', async () => {
    const status = await getDaemonStatus(paths);
    expect(status).toBe("stopped");
  });

  test('returns "stale" when PID file exists but process dead', async () => {
    await writeFile(paths.pidFile, "99999\n");
    const status = await getDaemonStatus(paths);
    expect(status).toBe("stale");
  });
});

describe("cleanStaleDaemon", () => {
  let tmpDir: string;
  let paths: DaemonPaths;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-test-"));
    paths = {
      pidFile: join(tmpDir, "daemon.pid"),
      socketPath: join(tmpDir, "daemon.sock"),
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("removes PID and socket files", async () => {
    await writeFile(paths.pidFile, "12345\n");
    await writeFile(paths.socketPath, "");

    await cleanStaleDaemon(paths);

    const pidExists = await Bun.file(paths.pidFile).exists();
    const sockExists = await Bun.file(paths.socketPath).exists();
    expect(pidExists).toBe(false);
    expect(sockExists).toBe(false);
  });

  test("succeeds when files don't exist (no throw)", async () => {
    // Should not throw
    await cleanStaleDaemon(paths);
  });
});
