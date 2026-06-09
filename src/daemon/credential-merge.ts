/**
 * Merge per-user credential overrides into a service config.
 * Creates a new config object — never mutates the original.
 */
import type { ServiceConfig } from "../config/index.ts";
import type { ServiceCredential } from "../credentials/index.ts";
import { createLogger } from "../logger/index.ts";

const log = createLogger("credential-merge");

/**
 * Apply credential overrides to a service config.
 * - For http/websocket: merges headers (user headers override service defaults)
 * - For stdio: merges env vars (user env overrides service defaults)
 * Returns a new ServiceConfig with credentials applied.
 */
export function mergeCredentials(
  serviceConfig: ServiceConfig,
  credential: ServiceCredential,
): ServiceConfig {
  const merged = structuredClone(serviceConfig);

  if (credential.headers && "headers" in merged) {
    merged.headers = { ...merged.headers, ...credential.headers };
  } else if (credential.headers) {
    log.warn("credential_field_mismatch", {
      field: "headers",
      backend: merged.backend,
      message: "Credential has headers but service config has no headers field",
    });
  }

  if (credential.env && "env" in merged) {
    merged.env = { ...merged.env, ...credential.env };
  } else if (credential.env) {
    log.warn("credential_field_mismatch", {
      field: "env",
      backend: merged.backend,
      message: "Credential has env but service config has no env field",
    });
  }

  return merged;
}

/**
 * Build a pool key that includes the userId when per-user credentials exist.
 * Standard connections use just the service name; per-user connections
 * include the userId to maintain separate transports with different credentials.
 */
export function userPoolKey(serviceName: string, userId?: string): string {
  return userId ? `${serviceName}::${userId}` : serviceName;
}
