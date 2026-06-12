import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigManager } from "../../src/daemon/config-manager.ts";
import { CredentialManager } from "../../src/credentials/index.ts";
import { startConfigFileWatchers, type FileWatchHandle } from "../../src/daemon/file-watch.ts";
import { TokenAuthProvider } from "../../src/daemon/auth-provider.ts";
import type { ServicesConfig } from "../../src/config/index.ts";

const ECHO_SERVICE = {
  backend: "stdio" as const,
  command: "/usr/bin/echo",
  args: [],
  env: {},
};

describe("config file watchers", () => {
  let tempDir: string | null = null;
  let watcher: FileWatchHandle | null = null;

  afterEach(async () => {
    watcher?.close();
    watcher = null;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function setup() {
    tempDir = await mkdtemp(join(tmpdir(), "mcp2cli-watch-test-"));
    const configPath = join(tempDir, "services.json");
    const credentialsPath = join(tempDir, "credentials.json");
    const tokensPath = join(tempDir, "tokens.json");
    const initialConfig: ServicesConfig = {
      services: {
        echo: ECHO_SERVICE,
      },
    };
    await Bun.write(configPath, JSON.stringify(initialConfig, null, 2));
    await Bun.write(credentialsPath, JSON.stringify({ groups: {}, credentials: {}, defaults: {} }, null, 2));
    await Bun.write(tokensPath, JSON.stringify({ tokens: [{ id: "skippy", token: "before", role: "agent" }] }, null, 2));
    const configManager = new ConfigManager(initialConfig, configPath);
    const credentialManager = await CredentialManager.load(credentialsPath);
    const authProvider = await TokenAuthProvider.load(tokensPath);
    watcher = startConfigFileWatchers({
      configManager,
      credentialManager,
      authProvider,
      debounceMs: 10,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { configPath, credentialsPath, tokensPath, configManager, credentialManager, authProvider };
  }

  test("auto-reloads services.json after a valid file edit", async () => {
    const { configPath, configManager } = await setup();
    await Bun.write(
      configPath,
      JSON.stringify({
        services: {
          echo: ECHO_SERVICE,
          cat: {
            backend: "stdio",
            command: "/bin/cat",
            args: [],
            env: {},
          },
        },
      }, null, 2),
    );

    await waitFor(() => configManager.getService("cat") !== null);
    expect(configManager.serviceNames.sort()).toEqual(["cat", "echo"]);
  });

  test("keeps previous services config when edited file is invalid", async () => {
    const { configPath, configManager } = await setup();
    await Bun.write(configPath, JSON.stringify({ services: {} }, null, 2));

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(configManager.serviceNames).toEqual(["echo"]);
  });

  test("auto-reloads credentials.json after a valid file edit", async () => {
    const { credentialsPath, credentialManager } = await setup();
    await Bun.write(
      credentialsPath,
      JSON.stringify({
        groups: {},
        credentials: {},
        defaults: {
          echo: {
            env: { ECHO_TOKEN: "changed" },
          },
        },
      }, null, 2),
    );

    await waitFor(() => credentialManager.resolve("anyone", "echo")?.env?.ECHO_TOKEN === "changed");
    expect(credentialManager.resolve("anyone", "echo")?.env?.ECHO_TOKEN).toBe("changed");
  });

  test("auto-reloads tokens.json after a valid file edit", async () => {
    const { tokensPath, authProvider } = await setup();
    expect(
      authProvider.authenticate(
        new Request("http://localhost/call", {
          method: "POST",
          headers: { Authorization: "Bearer before" },
        }),
      )?.userId,
    ).toBe("skippy");

    await Bun.write(
      tokensPath,
      JSON.stringify({
        tokens: [{ id: "rico", token: "after", role: "admin" }],
      }, null, 2),
    );

    await waitFor(() =>
      authProvider.authenticate(
        new Request("http://localhost/call", {
          method: "POST",
          headers: { Authorization: "Bearer after" },
        }),
      )?.userId === "rico",
    );
    expect(
      authProvider.authenticate(
        new Request("http://localhost/call", {
          method: "POST",
          headers: { Authorization: "Bearer before" },
        }),
      ),
    ).toBeNull();
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}
