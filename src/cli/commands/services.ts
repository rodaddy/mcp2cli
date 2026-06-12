import type { CommandHandler } from "../../types/index.ts";
import { ConfigError, loadConfig } from "../../config/index.ts";
import { getRemoteServiceNames } from "../../process/index.ts";
import { getRemoteConfig } from "../../daemon/paths.ts";

/**
 * List configured MCP services from services.json.
 * Outputs JSON with service names, descriptions, and backend types.
 * Errors propagate to the main catch block as ConfigError.
 */
export const handleServices: CommandHandler = async (_args: string[]) => {
  const [config, remoteNames] = await Promise.all([
    loadConfig().catch((err) => {
      if (err instanceof ConfigError && err.code === "CONFIG_NOT_FOUND" && getRemoteConfig()) {
        return null;
      }
      throw err;
    }),
    getRemoteServiceNames(),
  ]);

  const services: Array<{
    name: string;
    description: string;
    backend: string;
    status: "configured" | "remote-configured";
  }> = Object.entries(config?.services ?? {}).map(([name, svc]) => ({
    name,
    description: svc.description ?? "(no description)",
    backend: svc.backend,
    status: "configured" as const,
  }));

  const localNames = new Set(services.map((svc) => svc.name));
  for (const name of remoteNames) {
    if (!localNames.has(name)) {
      services.push({
        name,
        description: "(remote only)",
        backend: "remote",
        status: "remote-configured" as const,
      });
    }
  }

  console.log(JSON.stringify({ services }));
};
