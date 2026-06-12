import { getRemoteConfig } from "../daemon/paths.ts";

const DEFAULT_REMOTE_SERVICE_CACHE_TTL_MS = 60_000;

export type RemoteServiceAvailability =
  | "hosted"
  | "not-hosted"
  | "unknown"
  | "no-remote";

interface RemoteServiceSnapshot {
  success?: boolean;
  configuredServices?: string[];
  version?: string;
}

let cachedSnapshot:
  | {
    cacheKey: string;
    expiresAt: number;
    snapshot: RemoteServiceSnapshot | null;
  }
  | null = null;

function cacheTtlMs(): number {
  const raw = process.env.MCP2CLI_REMOTE_SERVICE_CACHE_TTL_MS;
  if (!raw) return DEFAULT_REMOTE_SERVICE_CACHE_TTL_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_REMOTE_SERVICE_CACHE_TTL_MS;
}

function parseSnapshot(data: unknown): RemoteServiceSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const success = typeof obj.success === "boolean" ? obj.success : undefined;
  const configuredServices = Array.isArray(obj.configuredServices)
    ? obj.configuredServices.filter((svc): svc is string => typeof svc === "string")
    : undefined;
  const version = typeof obj.version === "string" ? obj.version : undefined;
  return { success, configuredServices, version };
}

export function clearRemoteServiceCache(): void {
  cachedSnapshot = null;
}

export async function getRemoteServiceSnapshot(): Promise<RemoteServiceSnapshot | null> {
  const remote = getRemoteConfig();
  if (!remote) return null;

  const cacheKey = `${remote.url}\0${remote.token ?? ""}`;
  const now = Date.now();
  if (cachedSnapshot && cachedSnapshot.cacheKey === cacheKey && cachedSnapshot.expiresAt > now) {
    return cachedSnapshot.snapshot;
  }

  let snapshot: RemoteServiceSnapshot | null = null;
  try {
    const headers: Record<string, string> = {};
    if (remote.token) {
      headers.Authorization = `Bearer ${remote.token}`;
    }
    const response = await fetch(`${remote.url.replace(/\/$/, "")}/api/services/discovery`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      snapshot = parseSnapshot(await response.json());
    }
  } catch {
    snapshot = null;
  }

  if (!snapshot?.configuredServices) {
    cachedSnapshot = null;
    return null;
  }

  cachedSnapshot = {
    cacheKey,
    expiresAt: now + cacheTtlMs(),
    snapshot,
  };
  return snapshot;
}

export async function getRemoteServiceNames(): Promise<string[]> {
  const snapshot = await getRemoteServiceSnapshot();
  return snapshot?.configuredServices ?? [];
}

export async function getRemoteServiceAvailability(
  serviceName: string | undefined,
): Promise<RemoteServiceAvailability> {
  if (!serviceName) return "unknown";
  if (!getRemoteConfig()) return "no-remote";
  const snapshot = await getRemoteServiceSnapshot();
  if (!snapshot?.configuredServices) return "unknown";
  return snapshot.configuredServices.includes(serviceName) ? "hosted" : "not-hosted";
}
