import { createLogger } from "../logger/index.ts";
import type { ServiceConfig } from "../config/index.ts";

const log = createLogger("secret-refs");
const SECRET_REF_PATTERN = /\$\{secret:([^}]+)\}/g;

export interface SecretResolver {
  resolve(ref: string): Promise<string>;
}

export function hasSecretRefs(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes("${secret:");
  }
  if (Array.isArray(value)) {
    return value.some(hasSecretRefs);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(hasSecretRefs);
  }
  return false;
}

export async function resolveServiceSecretRefs(
  serviceName: string,
  serviceConfig: ServiceConfig,
  resolver: SecretResolver,
): Promise<ServiceConfig> {
  if (!hasSecretRefs(serviceConfig)) return serviceConfig;
  const resolved = await resolveValue(serviceConfig, resolver) as ServiceConfig;
  log.info("secret_refs_resolved", { service: serviceName });
  return resolved;
}

async function resolveValue(value: unknown, resolver: SecretResolver): Promise<unknown> {
  if (typeof value === "string") {
    return resolveString(value, resolver);
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveValue(item, resolver)));
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, nested]) => [key, await resolveValue(nested, resolver)] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

async function resolveString(value: string, resolver: SecretResolver): Promise<string> {
  const matches = [...value.matchAll(SECRET_REF_PATTERN)];
  if (value.includes("${secret:") && matches.length === 0) {
    throw new SecretResolutionError("Malformed secret reference");
  }
  if (matches.length === 0) return value;

  let resolved = value;
  for (const match of matches) {
    const full = match[0];
    const ref = match[1]?.trim();
    if (!ref) {
      throw new SecretResolutionError("Empty secret reference");
    }
    const secretValue = await resolver.resolve(ref);
    resolved = resolved.replace(full, () => secretValue);
  }
  return resolved;
}

export class VaultwardenSecretResolver implements SecretResolver {
  private readonly cache = new Map<string, string>();

  async resolve(ref: string): Promise<string> {
    const cached = this.cache.get(ref);
    if (cached !== undefined) return cached;

    const parsed = parseSecretRef(ref);
    const credential = await fetchVaultwardenCredential(parsed.query);
    const value = extractSecretValue(credential, parsed.field);
    if (typeof value !== "string" || value.length === 0) {
      throw new SecretResolutionError(`Vaultwarden secret ref did not resolve a string value: ${redactRef(ref)}`);
    }
    this.cache.set(ref, value);
    return value;
  }
}

export class SecretResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretResolutionError";
  }
}

function parseSecretRef(ref: string): { query: string; field?: string } {
  const [queryPart, fieldPart] = ref.split("#", 2);
  const query = queryPart?.trim();
  const field = fieldPart?.trim();
  if (!query) {
    throw new SecretResolutionError("Secret reference is missing a query");
  }
  return field ? { query, field } : { query };
}

async function fetchVaultwardenCredential(query: string): Promise<unknown> {
  const command = process.env.MCP2CLI_VAULTWARDEN_COMMAND ?? "mcp2cli";
  const commandArgs = parseCommandArgs(process.env.MCP2CLI_VAULTWARDEN_COMMAND_ARGS);
  const timeoutMs = resolveTimeoutMs();
  const proc = Bun.spawn([
    command,
    ...commandArgs,
    "vaultwarden-secrets",
    "get_credential",
    "--params",
    JSON.stringify({ query }),
  ], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      MCP2CLI_NO_DAEMON: process.env.MCP2CLI_VAULTWARDEN_USE_DAEMON === "1" ? "" : "1",
    },
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);

  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timeout);

  if (exitCode !== 0) {
    throw new SecretResolutionError(
      `Vaultwarden lookup failed for ${redactRef(query)}${timedOut ? " (timeout)" : ""}`,
    );
  }

  try {
    const parsed = JSON.parse(stdout);
    return unwrapMcpResult(parsed);
  } catch {
    throw new SecretResolutionError(`Vaultwarden lookup returned non-JSON output for ${redactRef(query)}`);
  }
}

function parseCommandArgs(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    // Fall through to whitespace split for simple local use.
  }
  return raw.split(/\s+/).filter(Boolean);
}

function resolveTimeoutMs(): number {
  const raw = process.env.MCP2CLI_VAULTWARDEN_TIMEOUT_MS;
  if (!raw) return 10_000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}

function unwrapMcpResult(value: unknown): unknown {
  if (value && typeof value === "object" && "success" in value && "result" in value) {
    return (value as { result: unknown }).result;
  }
  return value;
}

function extractSecretValue(credential: unknown, field: string | undefined): unknown {
  if (field) {
    return getPath(credential, field);
  }

  if (credential && typeof credential === "object") {
    const obj = credential as Record<string, unknown>;
    for (const key of ["value", "token", "password", "secret", "apiKey", "api_key"]) {
      if (typeof obj[key] === "string") return obj[key];
    }
    if (obj.fields && typeof obj.fields === "object") {
      return extractSecretValue(obj.fields, undefined);
    }
  }

  if (typeof credential === "string") return credential;
  return undefined;
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function redactRef(ref: string): string {
  return ref.length <= 4 ? "***" : `${ref.slice(0, 4)}***`;
}
