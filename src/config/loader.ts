import { ServicesConfigSchema } from "./schema.ts";
import { ConfigError } from "./errors.ts";
import type { ServicesConfig } from "./schema.ts";
import { createLogger } from "../logger/index.ts";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const log = createLogger("config-loader");

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

  return maybeImportConfig(result.data, path);
}

async function maybeImportConfig(
  localConfig: ServicesConfig,
  localPath: string,
): Promise<ServicesConfig> {
  if (!localConfig.importUrl) return localConfig;

  if (localConfig.importTtlSeconds !== undefined) {
    const ttlSeconds = localConfig.importTtlSeconds;
    const state = await readImportState(localPath);
    const ageMs = state
      ? Date.now() - state.importedAt
      : Number.POSITIVE_INFINITY;
    if (
      ttlSeconds > 0 &&
      state?.url === localConfig.importUrl &&
      ageMs < ttlSeconds * 1000
    ) {
      try {
        await validateImportUrl(localConfig.importUrl);
      } catch (err) {
        log.warn("config_import_cache_rejected", {
          url: redactImportUrl(localConfig.importUrl),
          error: err instanceof Error ? err.message : String(err),
        });
        return localConfig;
      }
      return mergeImportedConfig(localConfig, state.importedConfig);
    }
  }

  try {
    const response = await fetchImportUrl(localConfig.importUrl);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const importedRaw = await response.json();
    const imported = ServicesConfigSchema.safeParse(importedRaw);
    if (!imported.success) {
      const issues = imported.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      throw new Error(`validation failed: ${issues}`);
    }
    const merged = mergeImportedConfig(localConfig, imported.data);
    log.info("config_imported_on_load", {
      url: redactImportUrl(localConfig.importUrl),
      localServices: Object.keys(localConfig.services).length,
      importedServices: Object.keys(imported.data.services).length,
      mergedServices: Object.keys(merged.services).length,
    });
    await writeImportState(localPath, localConfig.importUrl, imported.data);
    return merged;
  } catch (err) {
    log.warn("config_import_failed", {
      url: redactImportUrl(localConfig.importUrl),
      error: err instanceof Error ? err.message : String(err),
    });
    return localConfig;
  }
}

async function fetchImportUrl(rawUrl: string): Promise<Response> {
  const originalUrl = new URL(rawUrl);
  let currentUrl = rawUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
    await validateImportUrl(currentUrl);
    const headers = buildImportHeaders(
      new URL(currentUrl).origin === originalUrl.origin,
    );
    const response = await fetch(currentUrl, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new Error("importUrl redirect missing Location header");
    }
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new Error("importUrl exceeded redirect limit");
}

function buildImportHeaders(
  includeAuthorization: boolean,
): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = process.env.MCP2CLI_IMPORT_TOKEN;
  if (token && includeAuthorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function validateImportUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid importUrl");
  }

  const allowHttp = process.env.MCP2CLI_IMPORT_ALLOW_HTTP === "1";
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error("importUrl must use https");
  }

  const allowedHosts = parseCsvEnv(process.env.MCP2CLI_IMPORT_ALLOWED_HOSTS);
  if (allowedHosts.size === 0) {
    throw new Error("MCP2CLI_IMPORT_ALLOWED_HOSTS is required for importUrl");
  }
  if (!allowedHosts.has(url.hostname)) {
    throw new Error(`importUrl host is not allowed: ${url.hostname}`);
  }

  if (
    process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE !== "1" &&
    isPrivateImportHost(url.hostname)
  ) {
    throw new Error(`importUrl host is private or local: ${url.hostname}`);
  }
  if (
    process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE !== "1" &&
    process.env.MCP2CLI_IMPORT_ALLOW_DNS !== "1" &&
    !isIP(normalizeImportHostname(url.hostname))
  ) {
    throw new Error("DNS importUrl hosts require MCP2CLI_IMPORT_ALLOW_DNS=1");
  }
  await validateResolvedImportHost(url.hostname);
}

function parseCsvEnv(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function isPrivateImportHost(hostname: string): boolean {
  let lower = normalizeImportHostname(hostname);
  const mappedIpv4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4?.[1]) lower = mappedIpv4[1];
  const mappedIpv4Hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedIpv4Hex?.[1] && mappedIpv4Hex[2]) {
    const high = Number.parseInt(mappedIpv4Hex[1], 16);
    const low = Number.parseInt(mappedIpv4Hex[2], 16);
    lower = [
      (high >> 8) & 0xff,
      high & 0xff,
      (low >> 8) & 0xff,
      low & 0xff,
    ].join(".");
  }
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower === "metadata.google.internal") return true;

  const family = isIP(lower);
  if (family === 4) {
    const parts = lower.split(".").map((part) => Number.parseInt(part, 10));
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
    if (a !== undefined && a >= 224) return true;
    if (lower === "100.100.100.200") return true;
  }
  if (family === 6) {
    if (lower === "::1") return true;
    if (
      lower.startsWith("fe80:") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd")
    )
      return true;
    if (lower.startsWith("ff")) return true;
  }
  return false;
}

function normalizeImportHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  if (lower.startsWith("[") && lower.endsWith("]")) {
    return lower.slice(1, -1);
  }
  return lower;
}

async function validateResolvedImportHost(hostname: string): Promise<void> {
  if (process.env.MCP2CLI_IMPORT_ALLOW_PRIVATE === "1") return;
  if (isIP(hostname)) return;
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  for (const address of addresses) {
    if (isPrivateImportHost(address.address)) {
      throw new Error(
        `importUrl host resolves to private or local address: ${hostname}`,
      );
    }
  }
}

async function readImportState(
  localPath: string,
): Promise<{
  url: string;
  importedAt: number;
  importedConfig: ServicesConfig;
} | null> {
  try {
    const raw = await Bun.file(importStatePath(localPath)).json();
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.url !== "string" || typeof obj.importedAt !== "number")
      return null;
    const imported = ServicesConfigSchema.safeParse(obj.importedConfig);
    if (!imported.success) return null;
    return {
      url: obj.url,
      importedAt: obj.importedAt,
      importedConfig: imported.data,
    };
  } catch {
    return null;
  }
}

async function writeImportState(
  localPath: string,
  url: string,
  importedConfig: ServicesConfig,
): Promise<void> {
  try {
    await Bun.write(
      importStatePath(localPath),
      JSON.stringify({ url, importedAt: Date.now(), importedConfig }, null, 2) +
        "\n",
    );
  } catch (err) {
    log.warn("config_import_state_write_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function importStatePath(localPath: string): string {
  return `${localPath}.import-state.json`;
}

function redactImportUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

export function mergeImportedConfig(
  localConfig: ServicesConfig,
  importedConfig: ServicesConfig,
): ServicesConfig {
  const services: ServicesConfig["services"] = structuredClone(
    localConfig.services,
  );

  for (const [name, importedService] of Object.entries(
    importedConfig.services,
  )) {
    if (services[name]) continue;
    services[name] = structuredClone(importedService);
    services[name].source = importedService.source ?? "remote";
  }

  return {
    ...localConfig,
    services,
  };
}
