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
            name: "search",
            description: "Search tool names and descriptions across cached services (alias: grep)",
            usage: 'mcp2cli search "pattern" [--json]',
          },
          {
            name: "audit",
            description: "View and manage tool call audit logs (tail, search, stats, clear)",
            usage: "mcp2cli audit <tail [n]|search <pattern>|stats|clear|path>",
          },
          {
            name: "skills",
            description: "Manage service skill bundles (list, get, install, diff, generate)",
            usage: "mcp2cli skills <list|get|install|diff|generate>",
          },
          {
            name: "batch",
            description: "Execute multiple tool calls from NDJSON stdin",
            usage: "echo '{\"service\":\"n8n\",\"tool\":\"n8n_list_workflows\",\"params\":{}}' | mcp2cli batch [--parallel]",
          },
          {
            name: "credentials",
            description: "Manage per-identity credential mappings for backend services",
            usage: "mcp2cli credentials <list|set|set-default|remove|remove-default|resolve|group|reload|bootstrap-open-brain>",
            subcommands: [
              { name: "list [identity]", description: "List all credentials or filter by identity" },
              { name: "set <identity> <service> --header 'K: V' [--env 'K=V']", description: "Set credentials for an identity on a service" },
              { name: "set-default <service> --header 'K: V' [--env 'K=V']", description: "Set default credentials for a service" },
              { name: "remove <identity> <service>", description: "Remove credentials for an identity on a service" },
              { name: "remove-default <service>", description: "Remove default credentials for a service" },
              { name: "resolve <userId> <service>", description: "Show effective credential for a user on a service" },
              { name: "group list", description: "List all credential groups" },
              { name: "group add <name> <members...>", description: "Create a credential group" },
              { name: "group add-members <name> <members...>", description: "Add members to an existing group" },
              { name: "group remove <name>", description: "Remove a credential group" },
              { name: "group remove-members <name> <members...>", description: "Remove members from a group" },
              { name: "reload", description: "Reload credentials from disk" },
              { name: "bootstrap-open-brain [--item name] [--force]", description: "Populate Open Brain per-identity credentials from a Vaultwarden item" },
            ],
          },
        ],
        examples: [
          "mcp2cli services",
          "mcp2cli n8n --help",
          "mcp2cli n8n n8n_list_workflows",
          "mcp2cli schema n8n.n8n_list_workflows",
          'mcp2cli n8n n8n_create_workflow --params \'{"name": "test"}\'',
          'echo \'{"service":"n8n","tool":"n8n_list_workflows","params":{}}\' | mcp2cli batch',
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
      '    search           Search tool names/descriptions across cached services',
      "    audit            View and manage tool call audit logs",
      "    skills           Manage service skill bundles (list, get, install)",
      "    batch            Execute multiple tool calls from NDJSON stdin",
      "    credentials      Manage per-identity credential mappings",
      "    daemon           Manage the daemon process (stop, status)",
      "",
      "CREDENTIAL MANAGEMENT:",
      "    credentials list [identity]                        List all or per-identity",
      "    credentials set <identity> <service> --header/--env  Set identity credential",
      "    credentials set-default <service> --header/--env   Set default credential",
      "    credentials remove <identity> <service>            Remove identity credential",
      "    credentials remove-default <service>               Remove default credential",
      "    credentials resolve <userId> <service>             Show effective credential",
      "    credentials bootstrap-open-brain [--item name] [--force]",
      "    credentials group list                             List groups",
      "    credentials group add <name> <member...>           Create group",
      "    credentials group add-members <name> <member...>   Add to group",
      "    credentials group remove <name>                    Remove group",
      "    credentials group remove-members <name> <member...>  Remove from group",
      "    credentials reload                                 Reload from disk",
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
