/**
 * Dry-run preview formatting.
 * Produces a structured preview of what a tool call would do without executing it.
 */

/** Structured dry-run preview output */
export interface DryRunPreview {
  dryRun: true;
  service: string;
  tool: string;
  params: Record<string, unknown>;
  toolDescription: string;
  inputSchema: object;
  fields?: string[];
}

/** Options for building a dry-run preview */
export interface DryRunPreviewOpts {
  service: string;
  tool: string;
  params: Record<string, unknown>;
  toolDescription: string;
  inputSchema: object;
  fields: string[];
}

/**
 * Assemble a dry-run preview object.
 * Includes fields array only when it has items.
 */
export function formatDryRunPreview(opts: DryRunPreviewOpts): DryRunPreview {
  const preview: DryRunPreview = {
    dryRun: true,
    service: opts.service,
    tool: opts.tool,
    params: opts.params,
    toolDescription: opts.toolDescription,
    inputSchema: opts.inputSchema,
  };

  if (opts.fields.length > 0) {
    preview.fields = opts.fields;
  }

  return preview;
}
