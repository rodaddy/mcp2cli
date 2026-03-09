import { describe, test, expect } from "bun:test";
import {
  rejectControlChars,
  rejectPathTraversal,
  rejectQueryFragment,
  rejectOverlongInput,
} from "../../src/validation/validators.ts";
import {
  validateIdentifier,
  validateText,
  validationResultToCliError,
} from "../../src/validation/pipelines.ts";
import type { ValidationResult } from "../../src/validation/types.ts";

describe("rejectControlChars", () => {
  test("rejects null byte", () => {
    const result = rejectControlChars("hello\x00world", "f");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
      expect(result.field).toBe("f");
      expect(result.message).toContain("control characters");
    }
  });

  test("accepts clean string", () => {
    const result = rejectControlChars("valid-string", "f");
    expect(result.valid).toBe(true);
  });
});

describe("rejectPathTraversal", () => {
  test("rejects literal traversal", () => {
    const result = rejectPathTraversal("../../etc/passwd", "f");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("rejects percent-encoded value", () => {
    const result = rejectPathTraversal("value%2fwith%20encoding", "f");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("accepts normal value", () => {
    const result = rejectPathTraversal("normal-value", "f");
    expect(result.valid).toBe(true);
  });
});

describe("rejectQueryFragment", () => {
  test("rejects question mark", () => {
    const result = rejectQueryFragment("id?query", "f");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("QUERY_INJECTION");
    }
  });

  test("rejects hash/fragment", () => {
    const result = rejectQueryFragment("id#frag", "f");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("FRAGMENT_INJECTION");
    }
  });

  test("accepts clean identifier", () => {
    const result = rejectQueryFragment("clean-id", "f");
    expect(result.valid).toBe(true);
  });
});

describe("rejectOverlongInput", () => {
  test("rejects over 10000 chars", () => {
    const result = rejectOverlongInput("a".repeat(10001), "f");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("INPUT_TOO_LONG");
    }
  });

  test("accepts exactly 10000 chars", () => {
    const result = rejectOverlongInput("a".repeat(10000), "f");
    expect(result.valid).toBe(true);
  });
});

describe("validateIdentifier pipeline", () => {
  test("runs all 4 validators -- rejects traversal", () => {
    const result = validateIdentifier("../secret", "f");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("PATH_TRAVERSAL");
    }
  });

  test("accepts clean identifier", () => {
    const result = validateIdentifier("abc-123_def", "f");
    expect(result.valid).toBe(true);
  });
});

describe("validateText pipeline", () => {
  test("rejects control chars in text", () => {
    const result = validateText("hello\x00", "f");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("CONTROL_CHAR");
    }
  });

  test("allows ? in text (lenient)", () => {
    const result = validateText("what is this?", "f");
    expect(result.valid).toBe(true);
  });
});

describe("validationResultToCliError", () => {
  test("converts failed result to CliError", () => {
    const failed: ValidationResult = {
      valid: false,
      code: "PATH_TRAVERSAL",
      field: "params.id",
      message: "params.id contains path traversal",
    };
    const error = validationResultToCliError(failed);
    expect(error.error).toBe(true);
    expect(error.code).toBe("INPUT_VALIDATION_ERROR");
    expect(error.message).toBe("params.id contains path traversal");
    expect(error.reason).toBe("PATH_TRAVERSAL");
  });
});
