import {
  parseToolCallArgs,
  validateToolCallInputs,
  formatToolResult,
  formatDryRunPreview,
  applyFieldMask,
} from "../../invocation/index.ts";
import { validationResultToCliError } from "../../validation/pipelines.ts";
import { ConfigError, loadConfig } from "../../config/index.ts";
import { connectToService } from "../../connection/index.ts";
import { connectToHttpService } from "../../connection/http-transport.ts";
import { connectToWebSocketService } from "../../connection/websocket-transport.ts";
import { callViaDaemon, getSchemaViaDaemon } from "../../process/index.ts";
import { getToolSchemaCached, resolveToolNameCached } from "../../schema/cached.ts";
import { auditToolCall, flushAuditQueue } from "../../logger/audit.ts";
import { checkToolAccess, extractPolicy } from "../../access/index.ts";
import { printError } from "../errors.ts";
import { EXIT_CODES } from "../../types/index.ts";
import type { ErrorCode } from "../../types/index.ts";
import type { SchemaOutput } from "../../schema/types.ts";
import { formatOutput } from "../../format/index.ts";
import { resolveDirectServiceConfig } from "./direct-service.ts";
import { shouldRouteMissingServiceToRemote } from "./remote-routing.ts";

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
  const daemonEnabled = !process.env.MCP2CLI_NO_DAEMON;
  let config: Awaited<ReturnType<typeof loadConfig>> | null = null;
  try {
    config = await loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError) || err.code !== "CONFIG_NOT_FOUND" || !daemonEnabled) {
      throw err;
    }
  }
  const service = config?.services[parsed.value.serviceName];

  if (!service) {
    if (await shouldRouteMissingServiceToRemote(parsed.value.serviceName, daemonEnabled)) {
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
        let outputData = result.result;
        if (parsed.value.fields.length > 0) {
          const { masked, missing } = applyFieldMask(result.result, parsed.value.fields);
          for (const field of missing) {
            process.stderr.write(`warning: field "${field}" not found in response\n`);
          }
          outputData = masked;
        }
        console.log(formatOutput(outputData, parsed.value.format));
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

    printError({
      error: true,
      code: "UNKNOWN_COMMAND",
      message: `Unknown service: "${parsed.value.serviceName}". Run 'mcp2cli services' to list available services.`,
    });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

  // Access control: check if tool is blocked by policy
  const policy = extractPolicy(service);
  const accessResult = checkToolAccess(parsed.value.toolName, policy);
  if (!accessResult.allowed) {
    printError({
      error: true,
      code: "TOOL_BLOCKED",
      message: `Tool '${parsed.value.toolName}' is blocked by access policy for service '${parsed.value.serviceName}'`,
    });
    process.exitCode = EXIT_CODES.VALIDATION;
    return;
  }

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

    // M5: No CLI-side audit for daemon path -- the daemon already writes a full audit entry
    // in its own finally block with resolvedTool, transport, params, and result.
    // CLI-side audit here would only duplicate log volume with no additional data.
    const result = await callViaDaemon({
      service: parsed.value.serviceName,
      tool: parsed.value.toolName,
      params: parsed.value.params,
    });

    if (result.success) {
      // Field masking on successful daemon response
      let outputData = result.result;
      if (parsed.value.fields.length > 0) {
        const { masked, missing } = applyFieldMask(result.result, parsed.value.fields);
        for (const field of missing) {
          process.stderr.write(`warning: field "${field}" not found in response\n`);
        }
        outputData = masked;
      }
      console.log(formatOutput(outputData, parsed.value.format));
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

  // 4. Connect to MCP server (stdio, http, or websocket)
  const directService = await resolveDirectServiceConfig(parsed.value.serviceName, service);
  const connection = directService.backend === "http"
    ? await connectToHttpService(directService)
    : directService.backend === "websocket"
      ? await connectToWebSocketService(directService)
      : await connectToService(directService);

  const directStartTime = performance.now();
  let directSuccess = false;
  let directResult: unknown;
  let directError: string | undefined;
  let directResolvedTool: string | undefined;
  let dryRun = false;
  const directTransport = directService.backend;

  try {
    // Dry-run interception (inside try/finally so connection closes)
    if (parsed.value.dryRun) {
      dryRun = true;
      const schema = await getToolSchemaCached(
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

    // 6. Call tool via MCP protocol (auto-resolve prefixed names, cache-aware)
    const { resolvedName } = await resolveToolNameCached(
      connection.client,
      parsed.value.toolName,
      parsed.value.serviceName,
    );
    directResolvedTool = resolvedName !== parsed.value.toolName ? resolvedName : undefined;

    const result = await connection.client.callTool({
      name: resolvedName,
      arguments: parsed.value.params,
    });

    // 7. Format result (throws ToolError if isError=true)
    const output = formatToolResult(result as Parameters<typeof formatToolResult>[0]);
    directResult = output.result;
    directSuccess = true;

    // 8. Field masking on successful response
    let outputData = output.result;
    if (parsed.value.fields.length > 0) {
      const { masked, missing } = applyFieldMask(output.result, parsed.value.fields);
      for (const field of missing) {
        process.stderr.write(`warning: field "${field}" not found in response\n`);
      }
      outputData = masked;
    }
    console.log(formatOutput(outputData, parsed.value.format));
    process.exitCode = EXIT_CODES.SUCCESS;
  } catch (err) {
    directError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    // L13: close connection first -- audit writes don't need the MCP connection,
    // and flushing the queue should not block connection teardown.
    await connection.close();

    // Skip audit for dry-run -- no actual tool invocation occurred
    if (!dryRun) {
      const directDuration = Math.round(performance.now() - directStartTime);
      auditToolCall({
        path: "cli",
        service: parsed.value.serviceName,
        tool: parsed.value.toolName,
        resolvedTool: directResolvedTool,
        transport: directTransport,
        params: parsed.value.params,
        result: directResult,
        durationMs: directDuration,
        success: directSuccess,
        error: directError,
      });
      await flushAuditQueue();
    }
  }
}
