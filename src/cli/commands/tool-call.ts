import {
  parseToolCallArgs,
  validateToolCallInputs,
  formatToolResult,
  formatDryRunPreview,
  applyFieldMask,
} from "../../invocation/index.ts";
import { validationResultToCliError } from "../../validation/pipelines.ts";
import { loadConfig } from "../../config/index.ts";
import { connectToService, connectToHttpService } from "../../connection/index.ts";
import { callViaDaemon, getSchemaViaDaemon } from "../../process/index.ts";
import { getToolSchema } from "../../schema/introspect.ts";
import { printError } from "../errors.ts";
import { EXIT_CODES } from "../../types/index.ts";
import type { ErrorCode } from "../../types/index.ts";
import type { SchemaOutput } from "../../schema/types.ts";

/**
 * Map daemon error codes to semantic exit codes.
 */
function mapErrorCodeToExit(code: ErrorCode): number {
  switch (code) {
    case "CONNECTION_ERROR":
      return EXIT_CODES.CONNECTION;
    case "TOOL_ERROR":
    case "TOOL_TIMEOUT":
      return EXIT_CODES.TOOL_ERROR;
    case "INPUT_VALIDATION_ERROR":
      return EXIT_CODES.VALIDATION;
    default:
      return EXIT_CODES.INTERNAL;
  }
}

/**
 * Orchestrate a full tool call: parse -> validate -> config -> connect -> call -> format -> output.
 *
 * Routes through daemon by default. Set MCP2CLI_NO_DAEMON=1 to use direct connection.
 *
 * Supports --dry-run (preview without execution, exit 10) and --fields (response masking).
 *
 * Pre-connection errors (parse, validation, unknown service) use printError + exitCode + return.
 * Post-connection errors (ToolError, ConnectionError) propagate to main().catch().
 */
export async function handleToolCall(args: string[]): Promise<void> {
  // 1. Parse CLI args into structured tool call
  const parsed = parseToolCallArgs(args);
  if (!parsed.ok) {
    printError(parsed.error);
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // 2. Validate inputs through Phase 3 hardening
  const validation = validateToolCallInputs(parsed.value);
  if (!validation.valid) {
    printError(validationResultToCliError(validation));
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // 3. Load config and resolve service
  const config = await loadConfig();
  const service = config.services[parsed.value.serviceName];

  if (!service) {
    printError({
      error: true,
      code: "UNKNOWN_COMMAND",
      message: `Unknown service: "${parsed.value.serviceName}". Run 'mcp2cli services' to list available services.`,
    });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  const daemonEnabled = !process.env.MCP2CLI_NO_DAEMON;

  if (daemonEnabled) {
    // Daemon path: route through persistent daemon process

    // Dry-run interception: fetch schema via daemon, show preview, exit 10
    if (parsed.value.dryRun) {
      const schemaResponse = await getSchemaViaDaemon({
        service: parsed.value.serviceName,
        tool: parsed.value.toolName,
      });

      if (!schemaResponse.success) {
        printError({
          error: true,
          code: schemaResponse.error.code,
          message: schemaResponse.error.message,
          ...(schemaResponse.error.reason ? { reason: schemaResponse.error.reason } : {}),
        });
        process.exitCode = mapErrorCodeToExit(schemaResponse.error.code);
        return;
      }

      const schema = schemaResponse.result as SchemaOutput;
      const preview = formatDryRunPreview({
        service: parsed.value.serviceName,
        tool: parsed.value.toolName,
        params: parsed.value.params,
        toolDescription: schema.description,
        inputSchema: schema.inputSchema,
        fields: parsed.value.fields,
      });

      console.log(JSON.stringify(preview));
      process.exitCode = EXIT_CODES.DRY_RUN;
      return;
    }

    const result = await callViaDaemon({
      service: parsed.value.serviceName,
      tool: parsed.value.toolName,
      params: parsed.value.params,
    });

    if (result.success) {
      // Field masking on successful daemon response
      if (parsed.value.fields.length > 0) {
        const { masked, missing } = applyFieldMask(result.result, parsed.value.fields);
        for (const field of missing) {
          process.stderr.write(`warning: field "${field}" not found in response\n`);
        }
        console.log(JSON.stringify({ success: true, result: masked }));
      } else {
        console.log(JSON.stringify(result));
      }
      process.exitCode = EXIT_CODES.SUCCESS;
    } else {
      printError({
        error: true,
        code: result.error.code,
        message: result.error.message,
        ...(result.error.reason ? { reason: result.error.reason } : {}),
      });
      process.exitCode = mapErrorCodeToExit(result.error.code);
    }
    return;
  }

  // Direct path (MCP2CLI_NO_DAEMON=1): legacy direct connection

  // 4. Connect to MCP server (stdio or http)
  const connection = service.backend === "http"
    ? await connectToHttpService(service)
    : await connectToService(service);

  try {
    // Dry-run interception (inside try/finally so connection closes)
    if (parsed.value.dryRun) {
      const schema = await getToolSchema(
        connection.client,
        parsed.value.toolName,
        parsed.value.serviceName,
      );

      if (!schema) {
        throw new Error(
          `Tool "${parsed.value.toolName}" not found on service "${parsed.value.serviceName}"`,
        );
      }

      const preview = formatDryRunPreview({
        service: parsed.value.serviceName,
        tool: parsed.value.toolName,
        params: parsed.value.params,
        toolDescription: schema.description,
        inputSchema: schema.inputSchema,
        fields: parsed.value.fields,
      });

      console.log(JSON.stringify(preview));
      process.exitCode = EXIT_CODES.DRY_RUN;
      return; // finally block closes connection
    }

    // 6. Call tool via MCP protocol
    const result = await connection.client.callTool({
      name: parsed.value.toolName,
      arguments: parsed.value.params,
    });

    // 7. Format result (throws ToolError if isError=true)
    const output = formatToolResult(result as Parameters<typeof formatToolResult>[0]);

    // 8. Field masking on successful response
    if (parsed.value.fields.length > 0) {
      const { masked, missing } = applyFieldMask(output.result, parsed.value.fields);
      for (const field of missing) {
        process.stderr.write(`warning: field "${field}" not found in response\n`);
      }
      console.log(JSON.stringify({ success: true, result: masked }));
    } else {
      console.log(JSON.stringify(output));
    }
    process.exitCode = EXIT_CODES.SUCCESS;
  } finally {
    await connection.close();
  }
}
