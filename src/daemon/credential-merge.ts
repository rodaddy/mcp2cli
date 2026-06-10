/**
 * Merge per-user credential overrides into a service config.
 * Creates a new config object — never mutates the original.
 * Supports caller template variables in header/env values.
 */
import type { ServiceConfig } from "../config/index.ts";
import type { ServiceCredential } from "../credentials/index.ts";
import { createLogger } from "../logger/index.ts";

const log = createLogger("credential-merge");

export interface CallerContext {
  id: string;
  role: string;
}

/**
 * Apply credential overrides to a service config, then expand caller templates.
 * - For http/websocket: merges headers (user headers override service defaults)
 * - For stdio: merges env vars (user env overrides service defaults)
 * - Template variables: ${caller.id}, ${caller.role} are substituted in all
 *   header values and env values when a CallerContext is provided.
 * Returns a new ServiceConfig with credentials applied and templates expanded.
 */
export function mergeCredentials(
  serviceConfig: ServiceConfig,
  credential: ServiceCredential,
  caller?: CallerContext,
): ServiceConfig {
  const merged = structuredClone(serviceConfig);

  if (credential.headers && (merged.backend === "http" || merged.backend === "websocket")) {
    merged.headers = { ...(merged.headers ?? {}), ...credential.headers };
  } else if (credential.headers) {
    log.warn("credential_field_mismatch", {
      field: "headers",
      backend: merged.backend,
      message: "Credential has headers but service config has no headers field",
    });
  }

  if (credential.env && merged.backend === "stdio") {
    merged.env = { ...(merged.env ?? {}), ...credential.env };
  } else if (credential.env) {
    log.warn("credential_field_mismatch", {
      field: "env",
      backend: merged.backend,
      message: "Credential has env but service config has no env field",
    });
  }

  if (caller) {
    expandCallerTemplates(merged, caller);
  }

  return merged;
}

/**
 * Apply caller templates to a service config without credential merging.
 * Use when the base service config has template variables but no
 * per-user credentials are configured.
 */
export function applyCallerTemplates(
  serviceConfig: ServiceConfig,
  caller: CallerContext,
): ServiceConfig {
  const merged = structuredClone(serviceConfig);
  expandCallerTemplates(merged, caller);
  return merged;
}

const TEMPLATE_PATTERN = /\$\{caller\.(\w+)\}/g;

function expandCallerTemplates(config: ServiceConfig, caller: CallerContext): void {
  const vars: Record<string, string> = {
    id: caller.id,
    role: caller.role,
  };

  const expand = (val: string): string =>
    val.replace(TEMPLATE_PATTERN, (_, key: string) => vars[key] ?? `\${caller.${key}}`);

  if ("headers" in config && config.headers) {
    for (const key of Object.keys(config.headers)) {
      config.headers[key] = expand(config.headers[key]!);
    }
  }

  if ("env" in config && config.env) {
    for (const key of Object.keys(config.env)) {
      config.env[key] = expand(config.env[key]!);
    }
  }
}

/**
 * Build a pool key that includes the userId when per-user credentials exist.
 * Standard connections use just the service name; per-user connections
 * include the userId to maintain separate transports with different credentials.
 */
export function userPoolKey(serviceName: string, userId?: string): string {
  if (!userId) return serviceName;
  const encoded = Buffer.from(JSON.stringify([serviceName, userId])).toString("base64url");
  return `credential:${encoded}`;
}
