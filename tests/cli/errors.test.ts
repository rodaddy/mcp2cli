import { describe, test, expect, beforeEach } from "bun:test";
import {
  printError,
  exitWithError,
  type CliError,
} from "../../src/cli/errors.ts";

describe("printError", () => {
  const originalLog = console.log;

  beforeEach(() => {
    console.log = originalLog;
  });

  test("outputs valid JSON to stdout with error, code, message fields", () => {
    const captured: string[] = [];
    console.log = (...args: unknown[]) => {
      captured.push(String(args[0]));
    };

    const error: CliError = {
      error: true,
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
    };

    printError(error);

    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]!);
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe("INTERNAL_ERROR");
    expect(parsed.message).toBe("Something went wrong");
  });

  test("includes optional reason field when provided", () => {
    const captured: string[] = [];
    console.log = (...args: unknown[]) => {
      captured.push(String(args[0]));
    };

    const error: CliError = {
      error: true,
      code: "CONFIG_VALIDATION_ERROR",
      message: "Invalid input",
      reason: 'Missing required field "name"',
    };

    printError(error);

    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]!);
    expect(parsed.reason).toBe('Missing required field "name"');
  });

  test("does not include reason field when not provided", () => {
    const captured: string[] = [];
    console.log = (...args: unknown[]) => {
      captured.push(String(args[0]));
    };

    const error: CliError = {
      error: true,
      code: "UNKNOWN_COMMAND",
      message: "msg",
    };

    printError(error);

    const parsed = JSON.parse(captured[0]!);
    expect(parsed).not.toHaveProperty("reason");
  });
});

describe("exitWithError", () => {
  test("outputs JSON error and sets process exit code", () => {
    const captured: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      captured.push(String(args[0]));
    };

    const error: CliError = {
      error: true,
      code: "INTERNAL_ERROR",
      message: "Critical failure",
    };

    // exitWithError calls process.exit(), so we mock it
    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code?: number) => {
      exitCode = code;
    }) as never;

    try {
      exitWithError(error, 1);
    } catch {
      // May throw if process.exit mock doesn't prevent execution
    }

    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]!);
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe("INTERNAL_ERROR");
    expect(exitCode).toBe(1);

    console.log = originalLog;
    process.exit = originalExit;
  });
});
