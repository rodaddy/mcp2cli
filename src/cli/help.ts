import pkg from "../../package.json";

const VERSION = pkg.version;

/**
 * Detect whether help should be output in AI-friendly JSON mode.
 * Priority: env var > flag > TTY auto-detect fallback.
 */
export function isAiMode(args?: string[]): boolean {
  if (process.env.MCP2CLI_HELP_MODE === "ai") return true;
  if (args?.includes("--help-format=ai")) return true;
  // TTY auto-detect removed: too aggressive for spawned/piped contexts.
  // AI mode requires explicit opt-in via env var or flag.
  return false;
}

/**
 * Print help output in human-readable or AI-friendly JSON format.
 */
export function printHelp(args?: string[]): void {
  if (isAiMode(args)) {
    console.log(
      JSON.stringify({
        name: "mcp2cli",
        version: VERSION,
        description:
          "MCP tool bridge for AI agents -- bash instead of inline MCP tools",
        commands: [
          {
            name: "services",
            description: "List configured MCP services",
            usage: "mcp2cli services",
          },
          {
            name: "<service> --help",
            description: "List available tools for a service",
            usage: "mcp2cli <service> --help",
          },
          {
            name: "<service> <tool> --format",
            description:
              "Output in a specific format: json (default), table, yaml, csv, ndjson",
            usage: "mcp2cli <service> <tool> --format table",
          },
          {
            name: "schema",
            description: "Get parameter schema for a service tool",
            usage: "mcp2cli schema <service>.<tool>",
          },
          {
            name: "bootstrap",
            description: "Auto-configure a service from claude.json MCP config",
            usage: "mcp2cli bootstrap",
          },
          {
            name: "generate-skills",
            description: "Generate skill files from service schemas",
            usage: "mcp2cli generate-skills <service>",
          },
          {
            name: "cache",
            description: "Manage schema cache (clear, status)",
            usage: "mcp2cli cache <clear [service]|status>",
          },
          {
            name: "grep",
            description: "Search tool names and descriptions across cached services",
            usage: 'mcp2cli grep "pattern"',
          },
        ],
        examples: [
          "mcp2cli services",
          "mcp2cli n8n --help",
          "mcp2cli n8n n8n_list_workflows",
          "mcp2cli schema n8n.n8n_list_workflows",
          'mcp2cli n8n n8n_create_workflow --params \'{"name": "test"}\'',
        ],
      }),
    );
  } else {
    const lines = [
      `mcp2cli v${VERSION} -- MCP tool bridge for AI agents`,
      "",
      "USAGE:",
      "    mcp2cli <command> [options]",
      "    mcp2cli <service> <tool> [--params '{}']",
      "",
      "COMMANDS:",
      "    services          List configured MCP services",
      "    <service> --help  List available tools for a service",
      "    schema            Get parameter schema for a service tool",
      "    bootstrap         Auto-configure from claude.json MCP config",
      "    generate-skills   Generate skill files from service schemas",
      "    cache             Manage schema cache (clear, status)",
      '    grep             Search tool names/descriptions across cached services',
      "",
      "EXAMPLES:",
      "    mcp2cli services",
      "    mcp2cli n8n --help",
      "    mcp2cli n8n n8n_list_workflows",
      "    mcp2cli schema n8n.n8n_list_workflows",
      "",
      "OPTIONS:",
      "    --help, -h        Show this help message",
      "    --version         Show version number",
      "    --help-format=ai  Output help as JSON for AI agents",
      "    --fresh           Bypass schema cache for one call",
      "    --format <type>   Output format: json (default), table, yaml, csv, ndjson",
    ];
    console.log(lines.join("\n"));
  }
}

/**
 * Get the version string.
 */
export function getVersion(): string {
  return VERSION;
}
