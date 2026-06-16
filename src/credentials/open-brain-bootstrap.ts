import type { ServiceCredential } from "./schema.ts";

export interface OpenBrainBootstrapCredential {
  identity: string;
  service: string;
  credential: ServiceCredential;
}

export interface OpenBrainBootstrapOptions {
  serviceName?: string;
}

export function buildOpenBrainCredentialsFromVaultwarden(
  vaultwardenCredential: unknown,
  options: OpenBrainBootstrapOptions = {},
): OpenBrainBootstrapCredential[] {
  const service = options.serviceName ?? "open-brain";
  const fields = extractFields(vaultwardenCredential);
  const credentials: OpenBrainBootstrapCredential[] = [];

  for (const [name, rawValue] of Object.entries(fields)) {
    if (!name.startsWith("AUTH_TOKEN_USER_")) continue;
    const identity = normalizeIdentity(name.slice("AUTH_TOKEN_USER_".length));
    const token = normalizeOpenBrainToken(rawValue);
    if (!identity || !token) continue;
    credentials.push({
      identity,
      service,
      credential: { headers: { Authorization: `Bearer ${token}` } },
    });
  }

  return credentials.sort((a, b) => a.identity.localeCompare(b.identity));
}

export function normalizeOpenBrainToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return null;
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0) {
    const role = trimmed.slice(0, colonIdx);
    const token = trimmed.slice(colonIdx + 1);
    if (["admin", "agent", "discord", "n8n", "readonly"].includes(role) && token) {
      return token;
    }
  }
  return trimmed;
}

function normalizeIdentity(raw: string): string | null {
  const identity = raw.trim().toLowerCase().replace(/_/g, "-");
  return /^[a-z0-9][a-z0-9-]{0,255}$/.test(identity) ? identity : null;
}

function extractFields(value: unknown): Record<string, unknown> {
  const unwrapped = unwrapMcpResult(value);
  if (!unwrapped || typeof unwrapped !== "object") return {};
  const fields = (unwrapped as Record<string, unknown>).fields;
  if (!fields) return {};

  if (Array.isArray(fields)) {
    const out: Record<string, unknown> = {};
    for (const item of fields) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.name === "string") {
        out[obj.name] = obj.value;
      }
    }
    return out;
  }

  if (typeof fields === "object") {
    return fields as Record<string, unknown>;
  }

  return {};
}

function unwrapMcpResult(value: unknown): unknown {
  if (value && typeof value === "object" && "result" in value) {
    return (value as { result: unknown }).result;
  }
  return value;
}
