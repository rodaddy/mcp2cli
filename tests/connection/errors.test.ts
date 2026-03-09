import { describe, test, expect } from "bun:test";
import { ConnectionError } from "../../src/connection/errors.ts";
import type { ErrorCode } from "../../src/types/index.ts";

describe("ConnectionError", () => {
  test("is instanceof Error", () => {
    const err = new ConnectionError("test message");
    expect(err).toBeInstanceOf(Error);
  });

  test('has code "CONNECTION_ERROR"', () => {
    const err = new ConnectionError("test message");
    expect(err.code).toBe("CONNECTION_ERROR");
  });

  test('has name "ConnectionError"', () => {
    const err = new ConnectionError("test message");
    expect(err.name).toBe("ConnectionError");
  });

  test("stores message", () => {
    const err = new ConnectionError("spawn failed");
    expect(err.message).toBe("spawn failed");
  });

  test("stores optional reason", () => {
    const err = new ConnectionError("spawn failed", "ENOENT");
    expect(err.reason).toBe("ENOENT");
  });

  test("reason is undefined when not provided", () => {
    const err = new ConnectionError("test");
    expect(err.reason).toBeUndefined();
  });

  test("CONNECTION_ERROR is a valid ErrorCode", () => {
    // Type-level test: this assignment must compile
    const code: ErrorCode = "CONNECTION_ERROR";
    expect(code).toBe("CONNECTION_ERROR");
  });
});
