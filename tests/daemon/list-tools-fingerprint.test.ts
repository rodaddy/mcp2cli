/**
 * #58 / PR #59 regression guard: the daemon must stamp the BARE-service schema
 * fingerprint onto /list-tools and /schema responses -- NOT the per-credential
 * pool-key fingerprint. The client compares against its bare-key fingerprint, so
 * stamping the credential key never converges and clears the client cache on
 * every call. This test wires a per-user credential so the daemon's pool key is
 * genuinely a `credential:` key, distinct from the bare key -- it FAILS if the
 * stamp is reverted to the pool key.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemonServer } from "../../src/daemon/server.ts";
import { ConnectionPool } from "../../src/daemon/pool.ts";
import { IdleTimer } from "../../src/daemon/idle.ts";
import { MetricsCollector } from "../../src/daemon/metrics.ts";
import { writeCache } from "../../src/cache/index.ts";
import type { CredentialManager } from "../../src/credentials/index.ts";
import type {
  AuthProvider,
  AuthContext,
} from "../../src/daemon/auth-provider.ts";
import type { ServicesConfig } from "../../src/config/index.ts";

let tempDir: string;
let cacheDir: string;
let origCacheDir: string | undefined;
let pool: ConnectionPool;
let server: ReturnType<typeof createDaemonServer>;

const BARE_FP = "a".repeat(64);
const CREDENTIAL_FP = "b".repeat(64);
const USER_ID = "rico";

function makeConfig(): ServicesConfig {
  return {
    services: {
      "open-brain": {
        backend: "http",
        url: "http://ob.example/mcp",
        headers: {},
      },
    },
  };
}

class FakePool {
  async getConnection() {
    return {
      client: {
        async listTools() {
          return {
            tools: [
              { name: "ob_search", description: "Search", inputSchema: {} },
            ],
          };
        },
      },
    };
  }
  async closeAll() {}
}

// Auth provider that resolves any request to a fixed user identity.
const fakeAuth: AuthProvider = {
  enabled: true,
  authenticate(): AuthContext | null {
    return { userId: USER_ID, role: "admin" } as AuthContext;
  },
};

// Credential manager that returns a per-USER credential for open-brain, so
// resolveCredentialPool produces a `credential:` pool key (not the bare name).
const fakeCm = {
  resolveWithSource(userId: string, serviceName: string) {
    if (userId === USER_ID && serviceName === "open-brain") {
      return {
        credential: { headers: { Authorization: "Bearer x" } },
        source: "user" as const,
        identity: userId,
      };
    }
    return null;
  },
} as unknown as CredentialManager;

function cacheTool(name: string, hash: string) {
  return { name, description: `d-${name}`, inputSchema: {}, hash };
}

describe("#58 daemon stamps the bare-service fingerprint", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mcp2cli-fp-"));
    cacheDir = await mkdtemp(join(tmpdir(), "mcp2cli-fp-cache-"));
    origCacheDir = process.env.MCP2CLI_CACHE_DIR;
    process.env.MCP2CLI_CACHE_DIR = cacheDir;

    pool = new FakePool() as unknown as ConnectionPool;
    server = createDaemonServer({
      listenConfig: { mode: "unix", socketPath: join(tempDir, "daemon.sock") },
      pool,
      config: makeConfig(),
      idleTimer: new IdleTimer(60_000, () => {}),
      onShutdown: () => {},
      authProvider: fakeAuth,
      credentialManager: fakeCm,
      metrics: new MetricsCollector(),
    });
  });

  afterEach(async () => {
    server.stop(true);
    await pool.closeAll();
    if (origCacheDir !== undefined) process.env.MCP2CLI_CACHE_DIR = origCacheDir;
    else delete process.env.MCP2CLI_CACHE_DIR;
    await rm(tempDir, { recursive: true, force: true });
    await rm(cacheDir, { recursive: true, force: true });
  });

  test("/list-tools stamps the bare fingerprint even when the pool key is a credential key", async () => {
    // Bare entry and the credential entry carry DIFFERENT fingerprints.
    await writeCache("open-brain", [cacheTool("a", "h1")], 60_000, BARE_FP);
    const credKey = `credential:${Buffer.from(
      JSON.stringify(["open-brain", `user:${USER_ID}`]),
    ).toString("base64url")}`;
    await writeCache(credKey, [cacheTool("b", "h2")], 60_000, CREDENTIAL_FP);

    const res = await server.fetch(
      new Request("http://localhost/list-tools", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer any",
        },
        body: JSON.stringify({ service: "open-brain" }),
      }),
    );
    const body = (await res.json()) as {
      success: boolean;
      schemaFingerprint?: string;
    };

    expect(body.success).toBe(true);
    // Must be the BARE fingerprint. Reverting the stamp to the pool key yields
    // CREDENTIAL_FP here and fails the test -- catching a B1 regression.
    expect(body.schemaFingerprint).toBe(BARE_FP);
    expect(body.schemaFingerprint).not.toBe(CREDENTIAL_FP);
  });
});
