/**
 * Runtime credential management with per-identity resolution, group support,
 * and disk persistence. Matches ConfigManager patterns.
 *
 * Resolution order: user-specific → first matching group → defaults → null
 */
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CredentialKeySchema, CredentialsConfigSchema, ServiceCredentialSchema } from "./schema.ts";
import { clearCache } from "../cache/index.ts";
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

  get configFilePath(): string {
    return this.configPath;
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
   *
   * Note: When a user belongs to multiple groups, the first matching group wins.
   * Group iteration order follows Object.entries() order (insertion order in JSON).
   * This is intentional -- groups defined earlier in credentials.json take precedence.
   */
  resolve(userId: string, serviceName: string): ServiceCredential | null {
    return this.resolveWithSource(userId, serviceName)?.credential ?? null;
  }

  resolveWithSource(
    userId: string,
    serviceName: string,
  ): { credential: ServiceCredential; source: "user" | "group" | "default"; identity: string } | null {
    // 1. Direct user match
    const userCreds = this.config.credentials[userId]?.[serviceName];
    if (userCreds) return { credential: userCreds, source: "user", identity: userId };

    // 2. Group match (first matching group wins)
    for (const [groupName, members] of Object.entries(this.config.groups)) {
      if (members.includes(userId)) {
        const groupCreds = this.config.credentials[groupName]?.[serviceName];
        if (groupCreds) return { credential: groupCreds, source: "group", identity: groupName };
      }
    }

    // 3. Defaults
    const defaultCreds = this.config.defaults[serviceName];
    if (defaultCreds) return { credential: defaultCreds, source: "default", identity: "default" };

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
    this.validateKey("identity", identity);
    this.validateKey("service", serviceName);
    await this.transaction(async () => {
      const validated = this.validateCredential(credential);
      if (!this.config.credentials[identity]) {
        this.config.credentials[identity] = {};
      }
      this.config.credentials[identity]![serviceName] = validated;
    });
    await this.clearCredentialCaches(serviceName, identity);
    if (this.pool) {
      await this.pool.closeServicePattern(serviceName);
    }
    log.info("credential_set", { identity, service: serviceName });
  }

  /**
   * Set a default credential for a service.
   */
  async setDefault(serviceName: string, credential: unknown): Promise<void> {
    this.validateKey("service", serviceName);
    await this.transaction(async () => {
      const validated = this.validateCredential(credential);
      this.config.defaults[serviceName] = validated;
    });
    await this.clearServiceCaches(serviceName);
    if (this.pool) {
      await this.pool.closeService(serviceName);
    }
    log.info("default_set", { service: serviceName });
  }

  /**
   * Remove credentials for a specific identity and service.
   */
  async removeCredential(identity: string, serviceName: string): Promise<void> {
    this.validateKey("identity", identity);
    this.validateKey("service", serviceName);
    await this.transaction(async () => {
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
    });
    await this.clearCredentialCaches(serviceName, identity);
    if (this.pool) {
      await this.pool.closeServicePattern(serviceName);
    }
    log.info("credential_removed", { identity, service: serviceName });
  }

  /**
   * Remove a default credential for a service.
   */
  async removeDefault(serviceName: string): Promise<void> {
    this.validateKey("service", serviceName);
    await this.transaction(async () => {
      if (!this.config.defaults[serviceName]) {
        throw new CredentialManagerError(
          `No default credential found for service '${serviceName}'`,
        );
      }
      delete this.config.defaults[serviceName];
    });
    await this.clearServiceCaches(serviceName);
    if (this.pool) {
      await this.pool.closeService(serviceName);
    }
    log.info("default_removed", { service: serviceName });
  }

  /**
   * Add a group with initial members.
   */
  async addGroup(groupName: string, members: string[]): Promise<void> {
    this.validateKey("group", groupName);
    this.validateStringArray("members", members);
    this.validateGroupName(groupName);
    await this.transaction(async () => {
      if (this.config.groups[groupName]) {
        throw new CredentialManagerError(`Group already exists: ${groupName}`);
      }
      this.config.groups[groupName] = members;
    });
    await this.closeGroupCredentialConnections(groupName);
    log.info("group_added", { group: groupName, members });
  }

  /**
   * Add members to an existing group.
   */
  async addGroupMembers(groupName: string, members: string[]): Promise<void> {
    this.validateKey("group", groupName);
    this.validateStringArray("members", members);
    let newMembers: string[] = [];
    await this.transaction(async () => {
      const group = this.config.groups[groupName];
      if (!group) {
        throw new CredentialManagerError(`Group not found: ${groupName}`);
      }
      newMembers = members.filter((m) => !group.includes(m));
      group.push(...newMembers);
    });
    await this.clearGroupCredentialCaches(groupName);
    await this.closeGroupCredentialConnections(groupName);
    log.info("group_members_added", { group: groupName, added: newMembers });
  }

  /**
   * Remove members from a group.
   */
  async removeGroupMembers(groupName: string, members: string[]): Promise<void> {
    this.validateKey("group", groupName);
    this.validateStringArray("members", members);
    await this.transaction(async () => {
      const group = this.config.groups[groupName];
      if (!group) {
        throw new CredentialManagerError(`Group not found: ${groupName}`);
      }
      this.config.groups[groupName] = group.filter((m) => !members.includes(m));
    });
    await this.clearGroupCredentialCaches(groupName);
    await this.closeGroupCredentialConnections(groupName);
    log.info("group_members_removed", { group: groupName, removed: members });
  }

  /**
   * Remove an entire group and any credentials assigned to that group name.
   */
  async removeGroup(groupName: string): Promise<void> {
    this.validateKey("group", groupName);
    let affectedServices: string[] = [];
    await this.transaction(async () => {
      if (!this.config.groups[groupName]) {
        throw new CredentialManagerError(`Group not found: ${groupName}`);
      }
      affectedServices = Object.keys(this.config.credentials[groupName] ?? {});
      delete this.config.groups[groupName];
      if (this.config.credentials[groupName]) {
        delete this.config.credentials[groupName];
        log.info("group_credentials_cleaned", { group: groupName });
      }
    });
    await Promise.all(affectedServices.map((serviceName) => this.clearServiceCaches(serviceName)));
    await this.closeCredentialServices(affectedServices);
    log.info("group_removed", { group: groupName });
  }

  /**
   * Reload config from disk.
   */
  async reloadFromDisk(): Promise<void> {
    await this.enqueue(async () => {
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
      await this.clearAllCredentialCaches();
      if (this.pool) {
        await this.pool.closeAll();
      }
    });
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

  private validateStringArray(fieldName: string, value: unknown): asserts value is string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new CredentialManagerError(`${fieldName} must be an array of strings`);
    }
    for (const item of value) {
      this.validateKey(fieldName, item);
    }
  }

  private validateKey(fieldName: string, value: unknown): asserts value is string {
    const result = CredentialKeySchema.safeParse(value);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message).join(", ");
      throw new CredentialManagerError(`Invalid ${fieldName}: ${issues}`);
    }
  }

  private validateGroupName(groupName: string): void {
    if (this.config.credentials[groupName]) {
      throw new CredentialManagerError(
        `Group '${groupName}' conflicts with an existing credential identity`,
      );
    }
  }

  private async closeGroupCredentialConnections(groupName: string): Promise<void> {
    await this.closeCredentialServices(Object.keys(this.config.credentials[groupName] ?? {}));
  }

  private async closeCredentialServices(serviceNames: string[]): Promise<void> {
    if (!this.pool) return;
    for (const serviceName of serviceNames) {
      await this.pool.closeService(serviceName);
    }
  }

  private transaction(mutator: () => void | Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      const snapshot = structuredClone(this.config);
      try {
        await mutator();
        await this.doWrite();
      } catch (err) {
        this.config = snapshot;
        throw err;
      }
    });
  }

  private enqueue(opFn: () => void | Promise<void>): Promise<void> {
    const op = this.writeQueue.then(opFn);
    this.writeQueue = op.catch(() => {});
    return op;
  }

  private async clearCredentialCaches(serviceName: string, identity: string): Promise<void> {
    await clearCache(userPoolCacheKey(serviceName, identity)).catch(() => {});
    await this.clearServiceCaches(serviceName);
  }

  private async clearGroupCredentialCaches(groupName: string): Promise<void> {
    const services = Object.keys(this.config.credentials[groupName] ?? {});
    await Promise.all(services.map((serviceName) => this.clearServiceCaches(serviceName)));
  }

  private async clearServiceCaches(serviceName: string): Promise<void> {
    await clearCache(serviceName).catch(() => {});
    for (const userId of Object.keys(this.config.credentials)) {
      await clearCache(userPoolCacheKey(serviceName, userId)).catch(() => {});
    }
    for (const members of Object.values(this.config.groups)) {
      await Promise.all(members.map((userId) =>
        clearCache(userPoolCacheKey(serviceName, userId)).catch(() => {}),
      ));
    }
  }

  private async clearAllCredentialCaches(): Promise<void> {
    const services = new Set<string>(Object.keys(this.config.defaults));
    for (const serviceMap of Object.values(this.config.credentials)) {
      for (const serviceName of Object.keys(serviceMap)) {
        services.add(serviceName);
      }
    }
    await Promise.all(Array.from(services).map((serviceName) => this.clearServiceCaches(serviceName)));
  }

  private async doWrite(): Promise<void> {
    const tmpPath = this.configPath + ".tmp";
    await mkdir(dirname(this.configPath), { recursive: true, mode: 0o700 });
    await writeFile(tmpPath, JSON.stringify(this.config, null, 2) + "\n", { mode: 0o600 });
    await chmod(tmpPath, 0o600);
    await rename(tmpPath, this.configPath);
    log.debug("credentials_written", { path: this.configPath });
  }
}

function userPoolCacheKey(serviceName: string, userId: string): string {
  const encoded = Buffer.from(JSON.stringify([serviceName, userId])).toString("base64url");
  return `credential:${encoded}`;
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
