import type { ServiceConfig } from "../../config/index.ts";
import { resolveServiceSecretRefs, VaultwardenSecretResolver } from "../../secrets/index.ts";

export async function resolveDirectServiceConfig(
  serviceName: string,
  service: ServiceConfig,
): Promise<ServiceConfig> {
  return resolveServiceSecretRefs(
    serviceName,
    service,
    new VaultwardenSecretResolver(),
  );
}
