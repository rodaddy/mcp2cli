/**
 * Runtime config management with CRUD operations, disk persistence,
 * and remote import support. Wraps in-memory config with Zod validation.
 */
import { ServicesConfigSchema, ServiceSchema } from "../config/index.ts";
import type { ServicesConfig, ServiceConfig } from "../config/index.ts";
import { getConfigPath } from "../config/index.ts";
import { createLogger } from "../logger/index.ts";
import type { ConnectionPool } from "./pool.ts";

const log = createLogger("config-manager");

export class ConfigManager {
  private config: ServicesConfig;
  private configPath: string;
  private pool: ConnectionPool | null = null;
  private writeLock = false;

  constructor(initialConfig: ServicesConfig, configPath?: string) {
    this.config = initialConfig;
    this.configPath = configPath ?? getConfigPath();
  }

  /** Attach pool reference for connection lifecycle management. */
  setPool(pool: ConnectionPool): void {
    this.pool = pool;
  }

  /** Get current services config (read-only snapshot). */
  getServices(): ServicesConfig {
    return structuredClone(this.config);
  }

  /** Get a single service config by name, or null if not found. */
  getService(name: string): ServiceConfig | null {
    return this.config.services[name] ?? null;
  }

  /** List service names. */
  get serviceNames(): string[] {
    return Object.keys(this.config.services);
  }

  /**
   * Add a new service. Validates config via Zod, writes to disk.
   * Throws if the service name already exists.
   */
  async addService(name: string, serviceConfig: unknown): Promise<void> {
    if (this.config.services[name]) {
      throw new ConfigManagerError(`Service already exists: ${name}`);
    }

    const validated = this.validateServiceConfig(serviceConfig);
    this.config.services[name] = validated;
    await this.writeToDisk();
    log.info("service_added", { name, backend: validated.backend });
  }

  /**
   * Update an existing service. Validates config via Zod, writes to disk.
   * Closes existing connection so pool lazily reconnects with new config.
   */
  async updateService(name: string, serviceConfig: unknown): Promise<void> {
    if (!this.config.services[name]) {
      throw new ConfigManagerError(`Service not found: ${name}`);
    }

    const validated = this.validateServiceConfig(serviceConfig);

    // Close existing connection before updating config
    if (this.pool) {
      await this.pool.closeService(name);
    }

    this.config.services[name] = validated;
    await this.writeToDisk();
    log.info("service_updated", { name, backend: validated.backend });
  }

  /**
   * Remove a service. Closes its connection, removes from config, writes to disk.
   */
  async removeService(name: string): Promise<void> {
    if (!this.config.services[name]) {
      throw new ConfigManagerError(`Service not found: ${name}`);
    }

    // Close connection first
    if (this.pool) {
      await this.pool.closeService(name);
    }

    delete this.config.services[name];
    await this.writeToDisk();
    log.info("service_removed", { name });
  }

  /**
   * Reload config from disk. Closes connections for removed services.
   * Used after external edits (e.g., git pull).
   */
  async reloadFromDisk(): Promise<{ added: string[]; removed: string[]; updated: string[] }> {
    const file = Bun.file(this.configPath);
    const exists = await file.exists();
    if (!exists) {
      throw new ConfigManagerError(`Config file not found: ${this.configPath}`);
    }

    const raw = await file.json();
    const result = ServicesConfigSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      throw new ConfigManagerError(`Config validation failed: ${issues}`);
    }

    const newConfig = result.data;
    const diff = this.diffConfigs(this.config, newConfig);

    // Close connections for removed and updated services
    if (this.pool) {
      for (const name of [...diff.removed, ...diff.updated]) {
        await this.pool.closeService(name);
      }
    }

    this.config = newConfig;
    log.info("config_reloaded", diff);
    return diff;
  }

  /**
   * Import services from a remote URL. Fetches JSON, validates, merges or replaces.
   * Supports raw GitHub URLs, any HTTP endpoint serving valid services.json.
   */
  async importFromUrl(
    url: string,
    mode: "merge" | "replace" = "merge",
  ): Promise<{ added: string[]; removed: string[]; updated: string[] }> {
    log.info("importing_config", { url, mode });

    const response = await fetch(url);
    if (!response.ok) {
      throw new ConfigManagerError(`Failed to fetch config from ${url}: ${response.status} ${response.statusText}`);
    }

    const raw = await response.json();
    const result = ServicesConfigSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      throw new ConfigManagerError(`Imported config validation failed: ${issues}`);
    }

    const importedConfig = result.data;

    if (mode === "replace") {
      const diff = this.diffConfigs(this.config, importedConfig);

      // Close all existing connections for removed/updated services
      if (this.pool) {
        for (const name of [...diff.removed, ...diff.updated]) {
          await this.pool.closeService(name);
        }
      }

      this.config = importedConfig;
      await this.writeToDisk();
      log.info("config_imported_replace", diff);
      return diff;
    }

    // Merge mode: add new, update existing, keep unlisted
    const added: string[] = [];
    const updated: string[] = [];

    for (const [name, svcConfig] of Object.entries(importedConfig.services)) {
      if (this.config.services[name]) {
        // Close connection before updating
        if (this.pool) {
          await this.pool.closeService(name);
        }
        this.config.services[name] = svcConfig;
        updated.push(name);
      } else {
        this.config.services[name] = svcConfig;
        added.push(name);
      }
    }

    await this.writeToDisk();
    const diff = { added, removed: [], updated };
    log.info("config_imported_merge", diff);
    return diff;
  }

  /**
   * Build a raw GitHub URL from repo/branch/path components.
   */
  static buildGitHubRawUrl(repo: string, branch = "main", path = "services.json"): string {
    // Handle both "owner/repo" and full "https://github.com/owner/repo" formats
    const repoPath = repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
    return `https://raw.githubusercontent.com/${repoPath}/${branch}/${path}`;
  }

  // -- Private helpers --

  private validateServiceConfig(raw: unknown): ServiceConfig {
    const result = ServiceSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      throw new ConfigManagerError(`Invalid service config: ${issues}`);
    }
    return result.data;
  }

  private async writeToDisk(): Promise<void> {
    if (this.writeLock) {
      throw new ConfigManagerError("Concurrent write detected -- try again");
    }
    this.writeLock = true;
    try {
      await Bun.write(this.configPath, JSON.stringify(this.config, null, 2) + "\n");
      log.debug("config_written", { path: this.configPath });
    } finally {
      this.writeLock = false;
    }
  }

  private diffConfigs(
    oldConfig: ServicesConfig,
    newConfig: ServicesConfig,
  ): { added: string[]; removed: string[]; updated: string[] } {
    const oldNames = new Set(Object.keys(oldConfig.services));
    const newNames = new Set(Object.keys(newConfig.services));

    const added = [...newNames].filter((n) => !oldNames.has(n));
    const removed = [...oldNames].filter((n) => !newNames.has(n));
    const updated = [...newNames].filter(
      (n) => oldNames.has(n) && JSON.stringify(oldConfig.services[n]) !== JSON.stringify(newConfig.services[n]),
    );

    return { added, removed, updated };
  }
}

export class ConfigManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigManagerError";
  }
}
