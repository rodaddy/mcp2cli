import { readFileSync } from "node:fs";
import type { ParseResult } from "./types.ts";
import type { OutputFormat } from "../format/types.ts";
import { isValidFormat } from "../format/types.ts";

/**
 * Parse CLI argv into a structured tool call.
 * Expects: [serviceName, toolName, ...rest] where rest may contain --params, --dry-run, --fields, --format.
 *
 * Supports flag syntaxes:
 *   --params '{"key":"value"}'   (space-separated)
 *   --params='{"key":"value"}'   (equals-joined)
 *   --params -  / --params=-     (read the JSON object from stdin, so a secret
 *                                 value never appears in any process's argv)
 *   --dry-run                    (boolean flag)
 *   --fields 'id,name'           (space-separated)
 *   --fields='id,name'           (equals-joined)
 *   --format table               (space-separated)
 *   --format=yaml                (equals-joined)
 *
 * Returns a discriminated union -- callers check .ok before accessing .value or .error.
 */
export interface ParseOptions {
  /** Reads all of stdin. Injectable for tests; defaults to fd 0. */
  readStdin?: () => string;
}

/** The --params value that means "read the JSON from stdin". */
export const PARAMS_FROM_STDIN = "-";

export function parseToolCallArgs(args: string[], options: ParseOptions = {}): ParseResult {
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
  let format: OutputFormat = "json";

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

    if (arg === "--format") {
      const nextArg = rest[i + 1] as string | undefined;
      if (nextArg !== undefined) {
        if (!isValidFormat(nextArg)) {
          return {
            ok: false,
            error: {
              error: true,
              code: "INPUT_VALIDATION_ERROR",
              message: `Invalid format "${nextArg}". Valid formats: json, table, yaml, csv, ndjson`,
            },
          };
        }
        format = nextArg;
        i++; // advance past value
      }
      continue;
    }

    if (arg.startsWith("--format=")) {
      const value = arg.slice("--format=".length);
      if (!isValidFormat(value)) {
        return {
          ok: false,
          error: {
            error: true,
            code: "INPUT_VALIDATION_ERROR",
            message: `Invalid format "${value}". Valid formats: json, table, yaml, csv, ndjson`,
          },
        };
      }
      format = value;
      continue;
    }
  }

  // Default to empty object if no --params provided
  if (paramsJson === undefined) {
    return {
      ok: true,
      value: { serviceName, toolName, params: {}, dryRun, fields, format },
    };
  }

  // --params - : the JSON comes from stdin. Errors below never echo the input,
  // because stdin is the channel used for values that must not be shown.
  const fromStdin = paramsJson === PARAMS_FROM_STDIN;
  if (fromStdin) {
    try {
      paramsJson = (options.readStdin ?? (() => readFileSync(0, "utf8")))();
    } catch {
      return {
        ok: false,
        error: {
          error: true,
          code: "INPUT_VALIDATION_ERROR",
          message: "--params -: could not read stdin",
        },
      };
    }
    if (paramsJson.trim() === "") {
      return {
        ok: false,
        error: {
          error: true,
          code: "INPUT_VALIDATION_ERROR",
          message: "--params -: stdin was empty; pipe a JSON object",
        },
      };
    }
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
      value: { serviceName, toolName, params, dryRun, fields, format },
    };
  } catch (err) {
    // JSON.parse messages can quote part of the input; never for stdin.
    const message = fromStdin
      ? "stdin is not valid JSON (input not shown)"
      : err instanceof Error ? err.message : "Unknown parse error";
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
