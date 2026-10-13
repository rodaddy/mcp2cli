import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isDaemonAlive,
  isPidAlive,
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

describe("isPidAlive", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("returns true for the current process", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  test("returns false for a PID that does not exist", () => {
    expect(isPidAlive(99999)).toBe(false);
  });

  // The whole point of the helper: a process that exited but has not been
  // reaped still answers signal 0. Only Linux exposes the zombie state
  // via /proc, so the assertion is only meaningful there.
  //
  // A zombie needs a parent that never wait()s. Neither bun nor the shell
  // qualifies -- both reap the children they spawn -- so the fixture ORPHANS
  // the process instead: an intermediate shell backgrounds a child and exits
  // at once, the child is re-parented to PID 1, and it exits there. When PID 1
  // is not a reaper (act_runner runs job containers with `tail -f /dev/null`
  // as PID 1), the orphan stays a zombie, which is the exact production shape
  // this helper exists for.
  //
  // Under an init that DOES reap (a normal desktop or a container started with
  // --init) the orphan is collected immediately and no zombie is observable.
  // That is not a failure of isPidAlive, so the test reports itself as
  // inconclusive rather than asserting a zombie must exist.
  test.skipIf(process.platform !== "linux")(
    "returns false for an exited but unreaped process",
    async () => {
      const pidPath = join(tmpDir, "zombie.pid");
      const spawner = Bun.spawn(
        ["sh", "-c", `sh -c 'sleep 0.2; exit 0' & echo $! > ${pidPath}`],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
      await spawner.exited;

      const zombiePid = parseInt(
        (await readFile(pidPath, "utf-8").catch(() => "")).trim(),
        10,
      );
      expect(Number.isNaN(zombiePid)).toBe(false);

      let sawZombie = false;
      for (let i = 0; i < 200; i++) {
        const stat = await readFile(`/proc/${zombiePid}/stat`, "utf-8").catch(
          () => "",
        );
        if (!stat) break; // already reaped by a real init
        if (stat.slice(stat.lastIndexOf(")") + 1).trim().charAt(0) === "Z") {
          sawZombie = true;
          break;
        }
        await Bun.sleep(10);
      }

      // Whether a zombie is observable depends on PID 1, so this cannot be a
      // bare assertion. But it must not silently pass either: returning early
      // when no zombie appears would let a regression to plain kill(pid, 0)
      // go green on a reaping init. Assert against BOTH observed states, so
      // the test always exercises isPidAlive on a process that has exited.
      if (sawZombie) {
        // signal 0 lies here; isPidAlive must not.
        expect(() => process.kill(zombiePid, 0)).not.toThrow();
        expect(isPidAlive(zombiePid)).toBe(false);
      } else {
        // PID 1 reaped it, so the PID is fully gone and isPidAlive must agree.
        expect(isPidAlive(zombiePid)).toBe(false);
      }
    },
  );
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
