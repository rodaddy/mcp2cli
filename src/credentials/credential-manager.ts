/**
 * Runtime credential management with per-identity resolution, group support,
 * and disk persistence. Matches ConfigManager patterns.
 *
 * Resolution order: user-specific → first matching group → defaults → null
 */
import { chmod } from "node:fs/promises";
import { CredentialsConfigSchema, ServiceCredentialSchema } from "./schema.ts";
import type { CredentialsConfig, ServiceCredential } from "./schema.ts";
import { createLogger } from "../logger/index.ts";
import type { ConnectionPool } from "../daemon/pool.ts";

const log = createLogger("credential-manager");

export class CredentialManager {
  private config: CredentialsConfig;
  private configPath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private pool: ConnectionPool | null = null;

  constructor(initialConfig: CredentialsConfig, configPath: string) {
    this.config = initialConfig;
    this.configPath = configPath;
  }

  /**
   * Load credentials from disk. Returns empty config if file doesn't exist.
   */
  static async load(configPath?: string): Promise<CredentialManager> {
    const path = configPath ?? getCredentialsPath();
    const file = Bun.file(path);
    const exists = await file.exists();

    if (!exists) {
      log.info("no_credentials_file", { path });
      return new CredentialManager(
        { groups: {}, credentials: {}, defaults: {} },
        path,
      );
    }

    let raw: unknown;
    try {
      raw = await file.json();
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new CredentialManagerError(`Malformed JSON in credentials file ${path}: ${err.message}`);
      }
      throw err;
    }
    const result = CredentialsConfigSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      throw new CredentialManagerError(`Credentials validation failed: ${issues}`);
    }

    log.info("credentials_loaded", {
      path,
      identities: Object.keys(result.data.credentials).length,
      groups: Object.keys(result.data.groups).length,
      defaults: Object.keys(result.data.defaults).length,
    });
    return new CredentialManager(result.data, path);
  }

  /**
   * Resolve credentials for a given userId and service.
   * Returns the highest-priority credential match (user-specific > group > defaults),
   * or null if no credentials are configured for this combination.
   */
  resolve(userId: string, serviceName: string): ServiceCredential | null {
    // 1. Direct user match
    const userCreds = this.config.credentials[userId]?.[serviceName];
    if (userCreds) return userCreds;

    // 2. Group match (first matching group wins)
    for (const [groupName, members] of Object.entries(this.config.groups)) {
      if (members.includes(userId)) {
        const groupCreds = this.config.credentials[groupName]?.[serviceName];
        if (groupCreds) return groupCreds;
      }
    }

    // 3. Defaults
    const defaultCreds = this.config.defaults[serviceName];
    if (defaultCreds) return defaultCreds;

    return null;
  }

  /** Get the full config snapshot (read-only). */
  getConfig(): CredentialsConfig {
    return structuredClone(this.config);
  }

  /** Get config with header/env values redacted (first 4 chars + "***"). */
  getRedactedConfig(): CredentialsConfig {
    const clone = structuredClone(this.config);
    const redact = (val: string): string =>
      val.length <= 4 ? "***" : val.slice(0, 4) + "***";
    const redactCred = (cred: ServiceCredential): void => {
      if (cred.headers) {
        for (const key of Object.keys(cred.headers)) {
          cred.headers[key] = redact(cred.headers[key]!);
        }
      }
      if (cred.env) {
        for (const key of Object.keys(cred.env)) {
          cred.env[key] = redact(cred.env[key]!);
        }
      }
    };
    for (const identity of Object.values(clone.credentials)) {
      for (const cred of Object.values(identity)) {
        redactCred(cred);
      }
    }
    for (const cred of Object.values(clone.defaults)) {
      redactCred(cred);
    }
    return clone;
  }

  /** Attach pool reference for credential-change-driven connection eviction. */
  setPool(pool: ConnectionPool): void {
    this.pool = pool;
  }

  /** List all identity/group names that have credentials. */
  get identityNames(): string[] {
    return Object.keys(this.config.credentials);
  }

  /** List all group names. */
  get groupNames(): string[] {
    return Object.keys(this.config.groups);
  }

  /** Get members of a group. */
  getGroupMembers(groupName: string): string[] | null {
    return this.config.groups[groupName] ?? null;
  }

  /** List groups a userId belongs to. */
  getGroupsForUser(userId: string): string[] {
    return Object.entries(this.config.groups)
      .filter(([, members]) => members.includes(userId))
      .map(([name]) => name);
  }

  // --- Write operations ---

  /**
   * Set credentials for a specific identity and service.
   */
  async setCredential(
    identity: string,
    serviceName: string,
    credential: unknown,
  ): Promise<void> {
    const validated = this.validateCredential(credential);
    if (!this.config.credentials[identity]) {
      this.config.credentials[identity] = {};
    }
    this.config.credentials[identity]![serviceName] = validated;
    await this.writeToDisk();
    if (this.pool) {
      await this.pool.closeServicePattern(serviceName);
    }
    log.info("credential_set", { identity, service: serviceName });
  }

  /**
   * Set a default credential for a service.
   */
  async setDefault(serviceName: string, credential: unknown): Promise<void> {
    const validated = this.validateCredential(credential);
    this.config.defaults[serviceName] = validated;
    await this.writeToDisk();
    if (this.pool) {
      await this.pool.closeServicePattern(serviceName);
    }
    log.info("default_set", { service: serviceName });
  }

  /**
   * Remove credentials for a specific identity and service.
   */
  async removeCredential(identity: string, serviceName: string): Promise<void> {
    const identityCreds = this.config.credentials[identity];
    if (!identityCreds?.[serviceName]) {
      throw new CredentialManagerError(
        `No credential found for identity '${identity}' on service '${serviceName}'`,
      );
    }
    delete identityCreds[serviceName];
    if (Object.keys(identityCreds).length === 0) {
      delete this.config.credentials[identity];
    }
    await this.writeToDisk();
    if (this.pool) {
      await this.pool.closeServicePattern(serviceName);
    }
    log.info("credential_removed", { identity, service: serviceName });
  }

  /**
   * Remove a default credential for a service.
   */
  async removeDefault(serviceName: string): Promise<void> {
    if (!this.config.defaults[serviceName]) {
      throw new CredentialManagerError(
        `No default credential found for service '${serviceName}'`,
      );
    }
    delete this.config.defaults[serviceName];
    await this.writeToDisk();
    if (this.pool) {
      await this.pool.closeServicePattern(serviceName);
    }
    log.info("default_removed", { service: serviceName });
  }

  /**
   * Add a group with initial members.
   */
  async addGroup(groupName: string, members: string[]): Promise<void> {
    if (this.config.groups[groupName]) {
      throw new CredentialManagerError(`Group already exists: ${groupName}`);
    }
    this.config.groups[groupName] = members;
    await this.writeToDisk();
    log.info("group_added", { group: groupName, members });
  }

  /**
   * Add members to an existing group.
   */
  async addGroupMembers(groupName: string, members: string[]): Promise<void> {
    const group = this.config.groups[groupName];
    if (!group) {
      throw new CredentialManagerError(`Group not found: ${groupName}`);
    }
    const newMembers = members.filter((m) => !group.includes(m));
    group.push(...newMembers);
    await this.writeToDisk();
    log.info("group_members_added", { group: groupName, added: newMembers });
  }

  /**
   * Remove members from a group.
   */
  async removeGroupMembers(groupName: string, members: string[]): Promise<void> {
    const group = this.config.groups[groupName];
    if (!group) {
      throw new CredentialManagerError(`Group not found: ${groupName}`);
    }
    this.config.groups[groupName] = group.filter((m) => !members.includes(m));
    await this.writeToDisk();
    log.info("group_members_removed", { group: groupName, removed: members });
  }

  /**
   * Remove an entire group. Does NOT remove credentials assigned to that group name.
   */
  async removeGroup(groupName: string): Promise<void> {
    if (!this.config.groups[groupName]) {
      throw new CredentialManagerError(`Group not found: ${groupName}`);
    }
    delete this.config.groups[groupName];
    await this.writeToDisk();
    log.info("group_removed", { group: groupName });
  }

  /**
   * Reload config from disk.
   */
  async reloadFromDisk(): Promise<void> {
    const file = Bun.file(this.configPath);
    const exists = await file.exists();
    if (!exists) {
      throw new CredentialManagerError(`Credentials file not found: ${this.configPath}`);
    }
    let raw: unknown;
    try {
      raw = await file.json();
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new CredentialManagerError(`Malformed JSON in credentials file ${this.configPath}: ${err.message}`);
      }
      throw err;
    }
    const result = CredentialsConfigSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      throw new CredentialManagerError(`Credentials validation failed: ${issues}`);
    }
    this.config = result.data;
    log.info("credentials_reloaded", { path: this.configPath });
  }

  // --- Private helpers ---

  private validateCredential(raw: unknown): ServiceCredential {
    const result = ServiceCredentialSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      throw new CredentialManagerError(`Invalid credential: ${issues}`);
    }
    return result.data;
  }

  private writeToDisk(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.doWrite());
    return this.writeQueue;
  }

  private async doWrite(): Promise<void> {
    await Bun.write(
      this.configPath,
      JSON.stringify(this.config, null, 2) + "\n",
    );
    await chmod(this.configPath, 0o600);
    log.debug("credentials_written", { path: this.configPath });
  }
}

export class CredentialManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialManagerError";
  }
}

function getCredentialsPath(): string {
  if (process.env.MCP2CLI_CREDENTIALS_FILE) {
    return process.env.MCP2CLI_CREDENTIALS_FILE;
  }
  const home = process.env.HOME ?? "";
  return `${home}/.config/mcp2cli/credentials.json`;
}
