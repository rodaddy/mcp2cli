import type { ParseResult } from "./types.ts";

/**
 * Parse CLI argv into a structured tool call.
 * Expects: [serviceName, toolName, ...rest] where rest may contain --params, --dry-run, --fields.
 *
 * Supports flag syntaxes:
 *   --params '{"key":"value"}'   (space-separated)
 *   --params='{"key":"value"}'   (equals-joined)
 *   --dry-run                    (boolean flag)
 *   --fields 'id,name'           (space-separated)
 *   --fields='id,name'           (equals-joined)
 *
 * Returns a discriminated union -- callers check .ok before accessing .value or .error.
 */
export function parseToolCallArgs(args: string[]): ParseResult {
  const serviceName = args[0] as string | undefined;
  const toolName = args[1] as string | undefined;

  if (!serviceName || !toolName) {
    return {
      ok: false,
      error: {
        error: true,
        code: "UNKNOWN_COMMAND",
        message:
          "Missing tool name. Run 'mcp2cli <service> --help' to list available tools.",
      },
    };
  }

  // Initialize flag state
  let paramsJson: string | undefined;
  let dryRun = false;
  let fields: string[] = [];

  // Unified multi-flag scan: process ALL flags in a single pass
  const rest = args.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string | undefined;
    if (!arg) continue;

    if (arg === "--params") {
      const nextArg = rest[i + 1] as string | undefined;
      if (nextArg !== undefined) {
        paramsJson = nextArg;
        i++; // advance past value
      }
      continue;
    }

    if (arg.startsWith("--params=")) {
      paramsJson = arg.slice("--params=".length);
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--fields") {
      const nextArg = rest[i + 1] as string | undefined;
      if (nextArg !== undefined) {
        fields = nextArg.split(",").filter(Boolean);
        i++; // advance past value
      }
      continue;
    }

    if (arg.startsWith("--fields=")) {
      fields = arg.slice("--fields=".length).split(",").filter(Boolean);
      continue;
    }
  }

  // Default to empty object if no --params provided
  if (paramsJson === undefined) {
    return {
      ok: true,
      value: { serviceName, toolName, params: {}, dryRun, fields },
    };
  }

  // Parse JSON params
  try {
    const parsed: unknown = JSON.parse(paramsJson);

    // Ensure parsed value is a plain object (not null, array, or primitive)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        error: {
          error: true,
          code: "INPUT_VALIDATION_ERROR",
          message: `--params must be a JSON object, got ${parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed}`,
        },
      };
    }

    const params = parsed as Record<string, unknown>;
    return {
      ok: true,
      value: { serviceName, toolName, params, dryRun, fields },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown parse error";
    return {
      ok: false,
      error: {
        error: true,
        code: "INPUT_VALIDATION_ERROR",
        message: `Invalid JSON in --params: ${message}`,
      },
    };
  }
}
