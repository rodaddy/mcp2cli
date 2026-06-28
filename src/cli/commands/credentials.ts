/**
 * CLI commands for managing per-identity credential mappings.
 * Routes through daemon API for all operations.
 */
import { callViaDaemon, fetchDaemonApi } from "../../process/index.ts";
import {
  buildOpenBrainCredentialsFromVaultwarden,
  type OpenBrainBootstrapCredential,
} from "../../credentials/index.ts";

/**
 * Dispatch credential subcommands.
 * Usage:
 *   mcp2cli credentials list [identity]
 *   mcp2cli credentials set <identity> <service> --header "Key: Value" [--env "KEY=VALUE"]
 *   mcp2cli credentials set-default <service> --header "Key: Value" [--env "KEY=VALUE"]
 *   mcp2cli credentials remove <identity> <service>
 *   mcp2cli credentials remove-default <service>
 *   mcp2cli credentials resolve <userId> <service>
 *   mcp2cli credentials group list
 *   mcp2cli credentials group add <name> <member1> [member2...]
 *   mcp2cli credentials group add-members <name> <member1> [member2...]
 *   mcp2cli credentials group remove <name>
 *   mcp2cli credentials group remove-members <name> <member1> [member2...]
 *   mcp2cli credentials reload
 *   mcp2cli credentials bootstrap-open-brain [--item "Open Brain - Per-User Tokens"] [--service open-brain] [--force]
 */
export async function handleCredentials(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      await handleList(args.slice(1));
      break;
    case "set":
      await handleSet(args.slice(1));
      break;
    case "set-default":
      await handleSetDefault(args.slice(1));
      break;
    case "remove":
      await handleRemove(args.slice(1));
      break;
    case "remove-default":
      await handleRemoveDefault(args.slice(1));
      break;
    case "resolve":
      await handleResolve(args.slice(1));
      break;
    case "group":
      await handleGroup(args.slice(1));
      break;
    case "reload":
      await handleReload();
      break;
    case "bootstrap-open-brain":
      await handleBootstrapOpenBrain(args.slice(1));
      break;
    default:
      console.log(
        "Usage: mcp2cli credentials <list|set|set-default|remove|remove-default|resolve|group|reload|bootstrap-open-brain>",
      );
      break;
  }
}

async function handleList(args: string[]): Promise<void> {
  const result = await fetchDaemonApi("GET", "/api/credentials");
  if (args[0]) {
    // Filter to specific identity
    const identity = args[0];
    const creds = result as { credentials?: Record<string, unknown> };
    const filtered = creds.credentials?.[identity] ?? null;
    console.log(JSON.stringify({ identity, credentials: filtered }));
  } else {
    console.log(JSON.stringify(result));
  }
}

async function handleSet(args: string[]): Promise<void> {
  const identity = args[0];
  const service = args[1];
  if (!identity || !service) {
    console.log(
      "Usage: mcp2cli credentials set <identity> <service> --header 'Key: Value' [--env 'KEY=VALUE']",
    );
    return;
  }
  const credential = parseCredentialFlags(args.slice(2));
  if (!credential) return;

  const result = await fetchDaemonApi("POST", "/api/credentials", {
    identity,
    service,
    credential,
  });
  console.log(JSON.stringify(result));
}

async function handleSetDefault(args: string[]): Promise<void> {
  const service = args[0];
  if (!service) {
    console.log(
      "Usage: mcp2cli credentials set-default <service> --header 'Key: Value' [--env 'KEY=VALUE']",
    );
    return;
  }
  const credential = parseCredentialFlags(args.slice(1));
  if (!credential) return;

  const result = await fetchDaemonApi("POST", "/api/credentials/defaults", {
    service,
    credential,
  });
  console.log(JSON.stringify(result));
}

async function handleRemove(args: string[]): Promise<void> {
  const identity = args[0];
  const service = args[1];
  if (!identity || !service) {
    console.log("Usage: mcp2cli credentials remove <identity> <service>");
    return;
  }
  const result = await fetchDaemonApi("DELETE", "/api/credentials", {
    identity,
    service,
  });
  console.log(JSON.stringify(result));
}

async function handleRemoveDefault(args: string[]): Promise<void> {
  const service = args[0];
  if (!service) {
    console.log("Usage: mcp2cli credentials remove-default <service>");
    return;
  }
  const result = await fetchDaemonApi("DELETE", "/api/credentials/defaults", {
    service,
  });
  console.log(JSON.stringify(result));
}

async function handleResolve(args: string[]): Promise<void> {
  const userId = args[0];
  const service = args[1];
  if (!userId || !service) {
    console.log("Usage: mcp2cli credentials resolve <userId> <service>");
    return;
  }
  const result = await fetchDaemonApi(
    "GET",
    `/api/credentials/resolve?userId=${encodeURIComponent(userId)}&service=${encodeURIComponent(service)}`,
  );
  console.log(JSON.stringify(result));
}

async function handleGroup(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list": {
      const result = await fetchDaemonApi("GET", "/api/credentials/groups");
      console.log(JSON.stringify(result));
      break;
    }
    case "add": {
      const name = args[1];
      const members = args.slice(2);
      if (!name || members.length === 0) {
        console.log(
          "Usage: mcp2cli credentials group add <name> <member1> [member2...]",
        );
        return;
      }
      const result = await fetchDaemonApi("POST", "/api/credentials/groups", {
        name,
        members,
      });
      console.log(JSON.stringify(result));
      break;
    }
    case "add-members": {
      const name = args[1];
      const members = args.slice(2);
      if (!name || members.length === 0) {
        console.log(
          "Usage: mcp2cli credentials group add-members <name> <member1> [member2...]",
        );
        return;
      }
      const result = await fetchDaemonApi(
        "PUT",
        `/api/credentials/groups/${encodeURIComponent(name)}`,
        { members },
      );
      console.log(JSON.stringify(result));
      break;
    }
    case "remove": {
      const name = args[1];
      if (!name) {
        console.log("Usage: mcp2cli credentials group remove <name>");
        return;
      }
      const result = await fetchDaemonApi(
        "DELETE",
        `/api/credentials/groups/${encodeURIComponent(name)}`,
      );
      console.log(JSON.stringify(result));
      break;
    }
    case "remove-members": {
      const name = args[1];
      const members = args.slice(2);
      if (!name || members.length === 0) {
        console.log(
          "Usage: mcp2cli credentials group remove-members <name> <member1> [member2...]",
        );
        return;
      }
      const result = await fetchDaemonApi(
        "DELETE",
        `/api/credentials/groups/${encodeURIComponent(name)}`,
        { members },
      );
      console.log(JSON.stringify(result));
      break;
    }
    default:
      console.log(
        "Usage: mcp2cli credentials group <list|add|add-members|remove|remove-members>",
      );
      break;
  }
}

async function handleReload(): Promise<void> {
  const result = await fetchDaemonApi("POST", "/api/credentials/reload");
  console.log(JSON.stringify(result));
}

async function handleBootstrapOpenBrain(args: string[]): Promise<void> {
  const options = parseBootstrapOpenBrainFlags(args);
  if (!options) return;

  const lookup = await callViaDaemon({
    service: "vaultwarden-secrets",
    tool: "get_credential",
    params: { query: options.item },
  });
  if (!lookup.success) {
    console.log(JSON.stringify(lookup));
    return;
  }

  const desired = buildOpenBrainCredentialsFromVaultwarden(lookup.result, {
    serviceName: options.service,
  });
  const existing = (await fetchDaemonApi("GET", "/api/credentials")) as {
    credentials?: Record<string, Record<string, unknown>>;
  };
  const changed: string[] = [];
  const skipped: string[] = [];

  for (const entry of desired) {
    if (
      !options.force &&
      existing.credentials?.[entry.identity]?.[entry.service]
    ) {
      skipped.push(entry.identity);
      continue;
    }
    await fetchDaemonApi("POST", "/api/credentials", {
      identity: entry.identity,
      service: entry.service,
      credential: entry.credential,
    });
    changed.push(entry.identity);
  }

  console.log(
    JSON.stringify(
      formatOpenBrainBootstrapSummary(options, desired, changed, skipped),
    ),
  );
}

function parseBootstrapOpenBrainFlags(
  args: string[],
): { item: string; service: string; force: boolean } | null {
  const options = {
    item: "Open Brain - Per-User Tokens",
    service: "open-brain",
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--item" && args[i + 1]) {
      options.item = args[++i]!;
    } else if (arg === "--service" && args[i + 1]) {
      options.service = args[++i]!;
    } else if (arg === "--force") {
      options.force = true;
    } else {
      console.log(
        "Usage: mcp2cli credentials bootstrap-open-brain [--item 'Open Brain - Per-User Tokens'] [--service open-brain] [--force]",
      );
      return null;
    }
  }

  return options;
}

export function formatOpenBrainBootstrapSummary(
  options: { item: string; service: string },
  desired: OpenBrainBootstrapCredential[],
  changed: string[],
  skipped: string[],
): {
  success: true;
  service: string;
  item: string;
  changed: string[];
  skipped: string[];
  discovered: string[];
} {
  return {
    success: true,
    service: options.service,
    item: options.item,
    changed,
    skipped,
    discovered: desired.map((entry) => entry.identity),
  };
}

/**
 * Parse --header and --env flags into a ServiceCredential object.
 * --header "Authorization: Bearer xxx" -> { headers: { Authorization: "Bearer xxx" } }
 * --env "API_KEY=xxx" -> { env: { API_KEY: "xxx" } }
 */
function parseCredentialFlags(
  args: string[],
): { headers?: Record<string, string>; env?: Record<string, string> } | null {
  const headers: Record<string, string> = {};
  const env: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--header" && args[i + 1]) {
      const val = args[++i]!;
      const colonIdx = val.indexOf(":");
      if (colonIdx === -1) {
        console.log(`Invalid header format: "${val}". Expected "Key: Value".`);
        return null;
      }
      headers[val.slice(0, colonIdx).trim()] = val.slice(colonIdx + 1).trim();
    } else if (args[i] === "--env" && args[i + 1]) {
      const val = args[++i]!;
      const eqIdx = val.indexOf("=");
      if (eqIdx === -1) {
        console.log(`Invalid env format: "${val}". Expected "KEY=VALUE".`);
        return null;
      }
      env[val.slice(0, eqIdx)] = val.slice(eqIdx + 1);
    }
  }

  if (Object.keys(headers).length === 0 && Object.keys(env).length === 0) {
    console.log("Must provide at least one --header or --env flag.");
    return null;
  }

  const result: {
    headers?: Record<string, string>;
    env?: Record<string, string>;
  } = {};
  if (Object.keys(headers).length > 0) result.headers = headers;
  if (Object.keys(env).length > 0) result.env = env;
  return result;
}
