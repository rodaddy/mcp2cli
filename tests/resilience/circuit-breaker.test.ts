import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  loadState,
  saveState,
  clearState,
  resolveState,
  recordFailure,
  recordSuccess,
  shouldAttemptHttp,
  getCircuitBreakerDir,
  getStateFilePath,
} from "../../src/resilience/index.ts";
import type {
  CircuitBreakerState,
  CircuitBreakerConfig,
} from "../../src/resilience/index.ts";

// -- Test setup: use temp dir for circuit breaker state --

let testDir: string;
let origCacheDir: string | undefined;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "mcp2cli-cb-test-"));
  origCacheDir = process.env.MCP2CLI_CACHE_DIR;
  // Point cache dir to testDir/schemas so circuit-breaker resolves to testDir/circuit-breaker
  process.env.MCP2CLI_CACHE_DIR = join(testDir, "schemas");
});

afterEach(async () => {
  if (origCacheDir !== undefined) {
    process.env.MCP2CLI_CACHE_DIR = origCacheDir;
  } else {
    delete process.env.MCP2CLI_CACHE_DIR;
  }
  await rm(testDir, { recursive: true, force: true });
});

// -- Path resolution --

describe("getCircuitBreakerDir", () => {
  test("resolves to sibling of MCP2CLI_CACHE_DIR", () => {
    process.env.MCP2CLI_CACHE_DIR = "/custom/cache/schemas";
    expect(getCircuitBreakerDir()).toBe("/custom/cache/circuit-breaker");
    process.env.MCP2CLI_CACHE_DIR = join(testDir, "schemas");
  });

  test("falls back to HOME-based path", () => {
    delete process.env.MCP2CLI_CACHE_DIR;
    const home = process.env.HOME;
    expect(getCircuitBreakerDir()).toBe(
      join(home!, ".cache", "mcp2cli", "circuit-breaker"),
    );
    process.env.MCP2CLI_CACHE_DIR = join(testDir, "schemas");
  });
});

describe("getStateFilePath", () => {
  test("returns path with service name and .json extension", () => {
    const path = getStateFilePath("n8n");
    expect(path).toEndWith("circuit-breaker/n8n.json");
  });
});

// -- Load / Save / Clear --

describe("loadState", () => {
  test("returns initial closed state for unknown service", async () => {
    const state = await loadState("nonexistent");
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(0);
    expect(state.lastFailureAt).toBeNull();
    expect(state.openedAt).toBeNull();
    expect(state.lastSuccessAt).toBeNull();
  });

  test("returns initial state for corrupted file", async () => {
    const filePath = getStateFilePath("corrupt");
    const { mkdir: mkdirFs } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdirFs(dirname(filePath), { recursive: true });
    await Bun.write(filePath, "not json");

    const state = await loadState("corrupt");
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(0);
  });

  test("returns initial state for structurally invalid file", async () => {
    const filePath = getStateFilePath("invalid");
    const { mkdir: mkdirFs } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdirFs(dirname(filePath), { recursive: true });
    await Bun.write(filePath, JSON.stringify({ random: "data" }));

    const state = await loadState("invalid");
    expect(state.state).toBe("closed");
  });
});

describe("saveState + loadState", () => {
  test("round-trips state through disk", async () => {
    const state: CircuitBreakerState = {
      state: "open",
      failureCount: 5,
      lastFailureAt: "2026-03-09T10:00:00.000Z",
      openedAt: "2026-03-09T10:00:00.000Z",
      lastSuccessAt: "2026-03-09T09:00:00.000Z",
    };

    await saveState("test-svc", state);
    const loaded = await loadState("test-svc");

    expect(loaded.state).toBe("open");
    expect(loaded.failureCount).toBe(5);
    expect(loaded.openedAt).toBe("2026-03-09T10:00:00.000Z");
    expect(loaded.lastSuccessAt).toBe("2026-03-09T09:00:00.000Z");
  });
});

describe("clearState", () => {
  test("removes state file", async () => {
    await saveState("clear-me", {
      state: "open",
      failureCount: 3,
      lastFailureAt: null,
      openedAt: null,
      lastSuccessAt: null,
    });

    // Verify it exists
    const before = await loadState("clear-me");
    expect(before.state).toBe("open");

    await clearState("clear-me");

    // Should return initial state now
    const after = await loadState("clear-me");
    expect(after.state).toBe("closed");
    expect(after.failureCount).toBe(0);
  });

  test("does not throw for nonexistent service", async () => {
    // Should not throw
    await clearState("never-existed");
  });
});

// -- resolveState --

describe("resolveState", () => {
  const config: CircuitBreakerConfig = {
    failureThreshold: 5,
    cooldownMs: 60_000,
  };

  test("returns closed for closed state", () => {
    const state: CircuitBreakerState = {
      state: "closed",
      failureCount: 2,
      lastFailureAt: null,
      openedAt: null,
      lastSuccessAt: null,
    };
    expect(resolveState(state, config)).toBe("closed");
  });

  test("returns half-open for half-open state", () => {
    const state: CircuitBreakerState = {
      state: "half-open",
      failureCount: 5,
      lastFailureAt: null,
      openedAt: null,
      lastSuccessAt: null,
    };
    expect(resolveState(state, config)).toBe("half-open");
  });

  test("returns open when cooldown has not elapsed", () => {
    const state: CircuitBreakerState = {
      state: "open",
      failureCount: 5,
      lastFailureAt: null,
      openedAt: new Date().toISOString(), // just now
      lastSuccessAt: null,
    };
    expect(resolveState(state, config)).toBe("open");
  });

  test("returns half-open when cooldown has elapsed", () => {
    const pastTime = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
    const state: CircuitBreakerState = {
      state: "open",
      failureCount: 5,
      lastFailureAt: null,
      openedAt: pastTime,
      lastSuccessAt: null,
    };
    expect(resolveState(state, config)).toBe("half-open");
  });

  test("returns open when openedAt is null (edge case)", () => {
    const state: CircuitBreakerState = {
      state: "open",
      failureCount: 5,
      lastFailureAt: null,
      openedAt: null,
      lastSuccessAt: null,
    };
    // No openedAt means we can't calculate cooldown, stays open
    expect(resolveState(state, config)).toBe("open");
  });
});

// -- recordFailure --

describe("recordFailure", () => {
  const config: CircuitBreakerConfig = {
    failureThreshold: 3,
    cooldownMs: 60_000,
  };

  test("increments failure count in closed state", async () => {
    const state = await recordFailure("fail-test", config);
    expect(state.failureCount).toBe(1);
    expect(state.state).toBe("closed");
    expect(state.lastFailureAt).not.toBeNull();
  });

  test("opens circuit after reaching threshold", async () => {
    await recordFailure("threshold-test", config);
    await recordFailure("threshold-test", config);
    const state = await recordFailure("threshold-test", config);

    expect(state.failureCount).toBe(3);
    expect(state.state).toBe("open");
    expect(state.openedAt).not.toBeNull();
  });

  test("reopens circuit on half-open probe failure", async () => {
    // Manually set up a half-open state
    await saveState("probe-fail", {
      state: "half-open",
      failureCount: 5,
      lastFailureAt: null,
      openedAt: null,
      lastSuccessAt: null,
    });

    const state = await recordFailure("probe-fail", config);
    expect(state.state).toBe("open");
    expect(state.openedAt).not.toBeNull();
  });

  test("persists state to disk", async () => {
    await recordFailure("persist-test", config);
    // Read directly from disk to verify persistence
    const loaded = await loadState("persist-test");
    expect(loaded.failureCount).toBe(1);
  });
});

// -- recordSuccess --

describe("recordSuccess", () => {
  test("resets failure count and closes circuit", async () => {
    // Set up an open circuit
    await saveState("success-test", {
      state: "open",
      failureCount: 5,
      lastFailureAt: "2026-03-09T10:00:00.000Z",
      openedAt: "2026-03-09T10:00:00.000Z",
      lastSuccessAt: null,
    });

    const state = await recordSuccess("success-test");
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(0);
    expect(state.lastSuccessAt).not.toBeNull();
    expect(state.openedAt).toBeNull();
  });

  test("keeps closed state closed", async () => {
    const state = await recordSuccess("already-closed");
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(0);
  });

  test("closes half-open circuit on success", async () => {
    await saveState("half-open-success", {
      state: "half-open",
      failureCount: 5,
      lastFailureAt: null,
      openedAt: "2026-03-09T09:00:00.000Z",
      lastSuccessAt: null,
    });

    const state = await recordSuccess("half-open-success");
    expect(state.state).toBe("closed");
    expect(state.failureCount).toBe(0);
  });
});

// -- shouldAttemptHttp --

describe("shouldAttemptHttp", () => {
  const config: CircuitBreakerConfig = {
    failureThreshold: 3,
    cooldownMs: 60_000,
  };

  test("returns true for closed circuit", async () => {
    const result = await shouldAttemptHttp("closed-svc", config);
    expect(result).toBe(true);
  });

  test("returns false for open circuit", async () => {
    await saveState("open-svc", {
      state: "open",
      failureCount: 5,
      lastFailureAt: null,
      openedAt: new Date().toISOString(), // just opened
      lastSuccessAt: null,
    });

    const result = await shouldAttemptHttp("open-svc", config);
    expect(result).toBe(false);
  });

  test("returns true for half-open circuit (probe)", async () => {
    const pastTime = new Date(Date.now() - 120_000).toISOString();
    await saveState("halfopen-svc", {
      state: "open",
      failureCount: 5,
      lastFailureAt: null,
      openedAt: pastTime,
      lastSuccessAt: null,
    });

    const result = await shouldAttemptHttp("halfopen-svc", config);
    expect(result).toBe(true);
  });
});

// -- Full state machine lifecycle --

describe("circuit breaker lifecycle", () => {
  const config: CircuitBreakerConfig = {
    failureThreshold: 2,
    cooldownMs: 50, // short cooldown for testing
  };

  test("closed -> open -> half-open -> closed", async () => {
    // Start closed
    let attempt = await shouldAttemptHttp("lifecycle", config);
    expect(attempt).toBe(true);

    // Two failures -> opens
    await recordFailure("lifecycle", config);
    const openState = await recordFailure("lifecycle", config);
    expect(openState.state).toBe("open");

    // Immediately after opening: should not attempt
    attempt = await shouldAttemptHttp("lifecycle", config);
    expect(attempt).toBe(false);

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 60));

    // After cooldown: half-open, should attempt (probe)
    attempt = await shouldAttemptHttp("lifecycle", config);
    expect(attempt).toBe(true);

    // Success on probe -> closes circuit
    const closedState = await recordSuccess("lifecycle");
    expect(closedState.state).toBe("closed");
    expect(closedState.failureCount).toBe(0);
  });

  test("closed -> open -> half-open -> open (probe fails)", async () => {
    const svc = "lifecycle-probe-fail";

    // Two failures -> opens
    await recordFailure(svc, config);
    await recordFailure(svc, config);

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 60));

    // Half-open probe attempt
    const attempt = await shouldAttemptHttp(svc, config);
    expect(attempt).toBe(true);

    // Probe fails -> reopens
    const state = await recordFailure(svc, config);
    expect(state.state).toBe("open");
  });
});

// -- Disk persistence across "invocations" --

describe("cross-invocation persistence", () => {
  test("state persists and is readable after save", async () => {
    const config: CircuitBreakerConfig = {
      failureThreshold: 2,
      cooldownMs: 60_000,
    };

    // Simulate first CLI invocation: 2 failures -> open
    await recordFailure("persist-svc", config);
    await recordFailure("persist-svc", config);

    // Simulate second CLI invocation: read state directly
    const state = await loadState("persist-svc");
    expect(state.state).toBe("open");
    expect(state.failureCount).toBe(2);

    // shouldAttemptHttp should return false (circuit open, no cooldown elapsed)
    const attempt = await shouldAttemptHttp("persist-svc", config);
    expect(attempt).toBe(false);
  });

  test("atomic write prevents corruption", async () => {
    // Write state, verify the file is valid JSON
    await saveState("atomic-test", {
      state: "closed",
      failureCount: 1,
      lastFailureAt: new Date().toISOString(),
      openedAt: null,
      lastSuccessAt: null,
    });

    const filePath = getStateFilePath("atomic-test");
    const file = Bun.file(filePath);
    const content = await file.json();
    expect(content.state).toBe("closed");
    expect(content.failureCount).toBe(1);
  });

  test("no temp files left after successful write", async () => {
    await saveState("no-temp", {
      state: "closed",
      failureCount: 0,
      lastFailureAt: null,
      openedAt: null,
      lastSuccessAt: null,
    });

    const dir = getCircuitBreakerDir();
    const files = await readdir(dir);
    const tempFiles = files.filter((f) => f.includes(".tmp."));
    expect(tempFiles).toHaveLength(0);
  });
});
