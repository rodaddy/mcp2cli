/**
 * Schema introspection types.
 * Used by introspect.ts and format.ts to structure tool metadata.
 */

/** Summary of a single tool -- used in tool listings */
export interface ToolSummary {
  name: string;
  description: string;
}

/** Full schema output for a single tool -- used by `mcp2cli schema` command */
export interface SchemaOutput {
  tool: string;
  description: string;
  inputSchema: object;
  annotations?: object;
  usage: string;
}

/** Tool listing for a service -- used by `mcp2cli <service> --help` */
export interface ToolListing {
  service: string;
  description: string;
  tools: ToolSummary[];
  usage: string;
}

/** Parsed dot-notation argument (service.tool) */
export interface DotNotation {
  service: string;
  tool: string;
}
