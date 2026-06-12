import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { createLogger } from "../logger/index.ts";
import type { ConfigManager } from "./config-manager.ts";
import type { CredentialManager } from "../credentials/index.ts";
import type { TokenAuthProvider } from "./auth-provider.ts";

const log = createLogger("daemon:file-watch");
const DEFAULT_DEBOUNCE_MS = 100;

export interface FileWatchHandle {
  close(): void;
}

export function startConfigFileWatchers(opts: {
  configManager: ConfigManager;
  credentialManager: CredentialManager;
  authProvider?: TokenAuthProvider;
  debounceMs?: number;
}): FileWatchHandle {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const watchers: FSWatcher[] = [];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const schedule = (key: string, fn: () => Promise<void>) => {
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(key);
      fn().catch((err) => {
        log.warn("auto_reload_failed", {
          target: key,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, debounceMs);
    timers.set(key, timer);
  };

  const servicesWatcher = tryWatchPath(opts.configManager.configFilePath, () => {
    schedule("services", async () => {
      const diff = await opts.configManager.reloadFromDisk();
      log.info("services_auto_reloaded", diff);
    });
  });
  if (servicesWatcher) watchers.push(servicesWatcher);

  const credentialsWatcher = tryWatchPath(opts.credentialManager.configFilePath, () => {
    schedule("credentials", async () => {
      await opts.credentialManager.reloadFromDisk();
      log.info("credentials_auto_reloaded");
    });
  });
  if (credentialsWatcher) watchers.push(credentialsWatcher);

  const tokenPath = opts.authProvider?.configFilePath;
  if (tokenPath) {
    const tokensWatcher = tryWatchPath(tokenPath, () => {
      schedule("tokens", async () => {
        await opts.authProvider!.reloadFromDisk();
        log.info("tokens_auto_reloaded");
      });
    });
    if (tokensWatcher) watchers.push(tokensWatcher);
  }

  return {
    close() {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
}

function watchPath(path: string, onChange: () => void): FSWatcher {
  const dir = dirname(path);
  const file = basename(path);
  return watch(dir, (_eventType, changedName) => {
    if (!changedName || changedName.toString() === file) {
      onChange();
    }
  });
}

function tryWatchPath(path: string, onChange: () => void): FSWatcher | null {
  try {
    return watchPath(path, onChange);
  } catch (err) {
    log.warn("file_watch_unavailable", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
