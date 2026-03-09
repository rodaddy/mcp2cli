import type { CommandHandler } from "../../types/index.ts";
import { loadConfig } from "../../config/index.ts";

/**
 * List configured MCP services from services.json.
 * Outputs JSON with service names, descriptions, and backend types.
 * Errors propagate to the main catch block as ConfigError.
 */
export const handleServices: CommandHandler = async (_args: string[]) => {
  const config = await loadConfig();

  const services = Object.entries(config.services).map(([name, svc]) => ({
    name,
    description: svc.description ?? "(no description)",
    backend: svc.backend,
    status: "configured" as const,
  }));

  console.log(JSON.stringify({ services }));
};
