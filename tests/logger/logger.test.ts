import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createLogger, getLogLevel, setLogLevel, resetLogLevel } from "../../src/logger/index.ts";
import type { LogEntry, LogLevel } from "../../src/logger/types.ts";

/**
 * Capture stderr output during a callback.
 * Replaces process.stderr.write temporarily, returns captured strings.
 */
function captureStderr(fn: () => void): string[] {
  const captured: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk: string | Uint8Array) => {
    captured.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return captured;
}

describe("Logger", () => {
  const originalEnv = process.env.MCP2CLI_LOG_LEVEL;

  beforeEach(() => {
    // Reset to known state before each test
    delete process.env.MCP2CLI_LOG_LEVEL;
    resetLogLevel();
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.MCP2CLI_LOG_LEVEL = originalEnv;
    } else {
      delete process.env.MCP2CLI_LOG_LEVEL;
    }
    resetLogLevel();
  });

  describe("getLogLevel", () => {
    test("defaults to silent when MCP2CLI_LOG_LEVEL is not set", () => {
      expect(getLogLevel()).toBe("silent");
    });

    test("reads MCP2CLI_LOG_LEVEL env var", () => {
      process.env.MCP2CLI_LOG_LEVEL = "debug";
      resetLogLevel();
      expect(getLogLevel()).toBe("debug");
    });

    test("falls back to silent for invalid MCP2CLI_LOG_LEVEL", () => {
      process.env.MCP2CLI_LOG_LEVEL = "banana";
      resetLogLevel();
      expect(getLogLevel()).toBe("silent");
    });

    test("is case-insensitive", () => {
      process.env.MCP2CLI_LOG_LEVEL = "DEBUG";
      resetLogLevel();
      expect(getLogLevel()).toBe("debug");
    });
  });

  describe("setLogLevel", () => {
    test("overrides env var", () => {
      process.env.MCP2CLI_LOG_LEVEL = "error";
      resetLogLevel();
      setLogLevel("debug");
      expect(getLogLevel()).toBe("debug");
    });
  });

  describe("silent mode (default)", () => {
    test("produces no output at silent level", () => {
      const log = createLogger("test-component");
      const lines = captureStderr(() => {
        log.error("should not appear");
        log.warn("should not appear");
        log.info("should not appear");
        log.debug("should not appear");
      });
      expect(lines).toHaveLength(0);
    });
  });

  describe("log entry format", () => {
    test("emits valid JSON with required fields", () => {
      setLogLevel("debug");
      const log = createLogger("my-component");
      const lines = captureStderr(() => {
        log.info("hello world");
      });

      expect(lines).toHaveLength(1);
      const entry: LogEntry = JSON.parse(lines[0]!);
      expect(entry.level).toBe("info");
      expect(entry.component).toBe("my-component");
      expect(entry.message).toBe("hello world");
      expect(entry.timestamp).toBeDefined();
    });

    test("timestamp is valid ISO 8601", () => {
      setLogLevel("debug");
      const log = createLogger("ts-check");
      const lines = captureStderr(() => {
        log.error("check timestamp");
      });

      const entry: LogEntry = JSON.parse(lines[0]!);
      const parsed = new Date(entry.timestamp);
      expect(parsed.toISOString()).toBe(entry.timestamp);
    });

    test("includes data field when provided", () => {
      setLogLevel("debug");
      const log = createLogger("data-test");
      const lines = captureStderr(() => {
        log.info("with data", { count: 42, service: "test" });
      });

      const entry: LogEntry = JSON.parse(lines[0]!);
      expect(entry.data).toEqual({ count: 42, service: "test" });
    });

    test("omits data field when not provided", () => {
      setLogLevel("debug");
      const log = createLogger("no-data");
      const lines = captureStderr(() => {
        log.info("no data");
      });

      const entry: LogEntry = JSON.parse(lines[0]!);
      expect(entry.data).toBeUndefined();
    });

    test("each line is newline-terminated", () => {
      setLogLevel("debug");
      const log = createLogger("newline");
      const lines = captureStderr(() => {
        log.info("test");
      });

      expect(lines[0]!.endsWith("\n")).toBe(true);
    });
  });

  describe("component name", () => {
    test("scopes entries to the component", () => {
      setLogLevel("debug");
      const logA = createLogger("alpha");
      const logB = createLogger("beta");

      const lines = captureStderr(() => {
        logA.info("from alpha");
        logB.info("from beta");
      });

      expect(lines).toHaveLength(2);
      const entryA: LogEntry = JSON.parse(lines[0]!);
      const entryB: LogEntry = JSON.parse(lines[1]!);
      expect(entryA.component).toBe("alpha");
      expect(entryB.component).toBe("beta");
    });
  });

  describe("level filtering", () => {
    type EmittableLevel = Exclude<LogLevel, "silent">;
    const levels: Array<{ setTo: LogLevel; emits: EmittableLevel[]; suppresses: EmittableLevel[] }> = [
      {
        setTo: "error",
        emits: ["error"],
        suppresses: ["warn", "info", "debug"],
      },
      {
        setTo: "warn",
        emits: ["error", "warn"],
        suppresses: ["info", "debug"],
      },
      {
        setTo: "info",
        emits: ["error", "warn", "info"],
        suppresses: ["debug"],
      },
      {
        setTo: "debug",
        emits: ["error", "warn", "info", "debug"],
        suppresses: [],
      },
    ];

    for (const { setTo, emits, suppresses } of levels) {
      test(`level=${setTo} emits ${emits.join(",")} and suppresses ${suppresses.join(",") || "nothing"}`, () => {
        setLogLevel(setTo);
        const log = createLogger("filter-test");

        const lines = captureStderr(() => {
          log.error("e");
          log.warn("w");
          log.info("i");
          log.debug("d");
        });

        expect(lines).toHaveLength(emits.length);
        const emittedLevels = lines.map((l) => (JSON.parse(l) as LogEntry).level);
        expect(emittedLevels).toEqual(emits);
      });
    }
  });
});
