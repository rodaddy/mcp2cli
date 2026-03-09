import { ServicesConfigSchema } from "./schema.ts";
import { ConfigError } from "./errors.ts";
import type { ServicesConfig } from "./schema.ts";

/**
 * Resolve the config file path.
 * MCP2CLI_CONFIG env var overrides the default XDG-style location.
 * Never uses ~ -- always resolves via process.env.HOME.
 */
export function getConfigPath(): string {
  if (process.env.MCP2CLI_CONFIG) {
    return process.env.MCP2CLI_CONFIG;
  }
  const home = process.env.HOME;
  if (!home) {
    throw new ConfigError(
      "CONFIG_NOT_FOUND",
      "Cannot determine config path: HOME environment variable is not set",
      "Set the HOME env var or use MCP2CLI_CONFIG to specify the config file path",
    );
  }
  return `${home}/.config/mcp2cli/services.json`;
}

/**
 * Load and validate the services configuration file.
 *
 * Flow: check exists -> parse JSON -> validate schema -> return typed config.
 * Throws ConfigError with specific codes for each failure mode.
 *
 * @param configPath - Optional explicit path. Falls back to MCP2CLI_CONFIG env var,
 *                     then default XDG location (~/.config/mcp2cli/services.json).
 */
export async function loadConfig(configPath?: string): Promise<ServicesConfig> {
  const path = configPath ?? getConfigPath();

  // Check file exists before attempting to read
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    throw new ConfigError(
      "CONFIG_NOT_FOUND",
      `Config file not found: ${path}`,
      `Create ${path} or set MCP2CLI_CONFIG env var to point to your services.json`,
    );
  }

  // Parse JSON
  let raw: unknown;
  try {
    raw = await file.json();
  } catch {
    throw new ConfigError(
      "CONFIG_PARSE_ERROR",
      `Failed to parse config file as JSON: ${path}`,
      "Ensure the file contains valid JSON",
    );
  }

  // Validate against schema
  const result = ServicesConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const fieldPath =
          issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `  ${fieldPath}: ${issue.message}`;
      })
      .join("\n");
    throw new ConfigError(
      "CONFIG_VALIDATION_ERROR",
      `Config validation failed:\n${issues}`,
      "Check your services.json against the expected schema",
    );
  }

  return result.data;
}
