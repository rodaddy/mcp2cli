import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CredentialManager,
  CredentialManagerError,
} from "../../src/credentials/index.ts";
import type { CredentialsConfig } from "../../src/credentials/index.ts";

const SAMPLE_CONFIG: CredentialsConfig = {
  groups: {
    ai_agents: ["skippy", "bilby", "nagatha"],
    admins: ["rico"],
  },
  credentials: {
    rico: {
      "open-brain": { headers: { Authorization: "Bearer rico-ob" } },
      n8n: { env: { N8N_API_KEY: "rico-n8n" } },
    },
    ai_agents: {
      "open-brain": { headers: { Authorization: "Bearer agent-ob" } },
      n8n: { env: { N8N_API_KEY: "agent-n8n" } },
    },
  },
  defaults: {
    proxmox: { headers: { Authorization: "PVEAPIToken=shared" } },
    n8n: { env: { N8N_API_KEY: "default-n8n" } },
  },
};

describe("CredentialManager", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp2cli-cred-test-"));
    configPath = join(tmpDir, "credentials.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeManager(config: CredentialsConfig = SAMPLE_CONFIG): CredentialManager {
    return new CredentialManager(structuredClone(config), configPath);
  }

  describe("load", () => {
    test("loads valid config from disk", async () => {
      await Bun.write(configPath, JSON.stringify(SAMPLE_CONFIG));
      const mgr = await CredentialManager.load(configPath);
      expect(mgr.identityNames).toContain("rico");
      expect(mgr.groupNames).toContain("ai_agents");
    });

    test("returns empty config when file does not exist", async () => {
      const mgr = await CredentialManager.load(join(tmpDir, "nonexistent.json"));
      expect(mgr.identityNames).toEqual([]);
      expect(mgr.groupNames).toEqual([]);
    });

    test("throws on invalid config", async () => {
      await Bun.write(configPath, JSON.stringify({ groups: { bad: "notarray" } }));
      expect(CredentialManager.load(configPath)).rejects.toThrow(CredentialManagerError);
    });
  });

  describe("resolve", () => {
    test("returns direct user credential when it exists", () => {
      const mgr = makeManager();
      const cred = mgr.resolve("rico", "open-brain");
      expect(cred).not.toBeNull();
      expect(cred!.headers!.Authorization).toBe("Bearer rico-ob");
    });

    test("falls back to group credential when no direct match", () => {
      const mgr = makeManager();
      const cred = mgr.resolve("skippy", "open-brain");
      expect(cred).not.toBeNull();
      expect(cred!.headers!.Authorization).toBe("Bearer agent-ob");
    });

    test("falls back to defaults when no user or group match", () => {
      const mgr = makeManager();
      const cred = mgr.resolve("unknown-user", "proxmox");
      expect(cred).not.toBeNull();
      expect(cred!.headers!.Authorization).toBe("PVEAPIToken=shared");
    });

    test("returns null when no credential at any level", () => {
      const mgr = makeManager();
      const cred = mgr.resolve("unknown-user", "unknown-service");
      expect(cred).toBeNull();
    });

    test("user-specific overrides group for the same service", () => {
      const config: CredentialsConfig = {
        groups: { team: ["alice"] },
        credentials: {
          alice: { svc: { headers: { X: "user" } } },
          team: { svc: { headers: { X: "group" } } },
        },
        defaults: {},
      };
      const mgr = makeManager(config);
      expect(mgr.resolve("alice", "svc")!.headers!.X).toBe("user");
    });

    test("group overrides defaults for the same service", () => {
      const mgr = makeManager();
      // skippy is in ai_agents which has n8n credentials
      // defaults also has n8n credentials
      const cred = mgr.resolve("skippy", "n8n");
      expect(cred!.env!.N8N_API_KEY).toBe("agent-n8n");
    });

    test("first matching group wins when user is in multiple groups", () => {
      const config: CredentialsConfig = {
        groups: {
          group_a: ["bob"],
          group_b: ["bob"],
        },
        credentials: {
          group_a: { svc: { headers: { X: "group-a" } } },
          group_b: { svc: { headers: { X: "group-b" } } },
        },
        defaults: {},
      };
      const mgr = makeManager(config);
      expect(mgr.resolve("bob", "svc")!.headers!.X).toBe("group-a");
    });
  });

  describe("setCredential", () => {
    test("sets and persists a new credential", async () => {
      const mgr = makeManager({ groups: {}, credentials: {}, defaults: {} });
      await Bun.write(configPath, "{}");
      await mgr.setCredential("rico", "obv2", { headers: { Authorization: "Bearer new" } });

      const cred = mgr.resolve("rico", "obv2");
      expect(cred!.headers!.Authorization).toBe("Bearer new");

      // Verify disk
      const disk = await Bun.file(configPath).json();
      expect(disk.credentials.rico.obv2.headers.Authorization).toBe("Bearer new");
    });

    test("updates existing credential", async () => {
      await Bun.write(configPath, JSON.stringify(SAMPLE_CONFIG));
      const mgr = makeManager();
      await mgr.setCredential("rico", "open-brain", { headers: { Authorization: "Bearer updated" } });
      expect(mgr.resolve("rico", "open-brain")!.headers!.Authorization).toBe("Bearer updated");
    });

    test("rejects credential with neither headers nor env", async () => {
      await Bun.write(configPath, "{}");
      const mgr = makeManager({ groups: {}, credentials: {}, defaults: {} });
      expect(mgr.setCredential("rico", "svc", {})).rejects.toThrow(CredentialManagerError);
    });

    test("rejects invalid credential structure", async () => {
      await Bun.write(configPath, "{}");
      const mgr = makeManager({ groups: {}, credentials: {}, defaults: {} });
      expect(mgr.setCredential("rico", "svc", { headers: { bad: 123 } })).rejects.toThrow(CredentialManagerError);
    });
  });

  describe("setDefault", () => {
    test("sets and persists a default credential", async () => {
      await Bun.write(configPath, "{}");
      const mgr = makeManager({ groups: {}, credentials: {}, defaults: {} });
      await mgr.setDefault("shared-svc", { env: { KEY: "value" } });

      const cred = mgr.resolve("anyone", "shared-svc");
      expect(cred!.env!.KEY).toBe("value");
    });
  });

  describe("removeCredential", () => {
    test("removes an existing credential", async () => {
      await Bun.write(configPath, JSON.stringify(SAMPLE_CONFIG));
      const mgr = makeManager();
      await mgr.removeCredential("rico", "open-brain");
      expect(mgr.resolve("rico", "open-brain")).toBeNull();
    });

    test("removes identity key when last credential removed", async () => {
      const config: CredentialsConfig = {
        groups: {},
        credentials: { solo: { svc: { headers: { X: "1" } } } },
        defaults: {},
      };
      await Bun.write(configPath, JSON.stringify(config));
      const mgr = makeManager(config);
      await mgr.removeCredential("solo", "svc");
      expect(mgr.identityNames).not.toContain("solo");
    });

    test("throws when credential does not exist", async () => {
      await Bun.write(configPath, "{}");
      const mgr = makeManager({ groups: {}, credentials: {}, defaults: {} });
      expect(mgr.removeCredential("nobody", "svc")).rejects.toThrow(CredentialManagerError);
    });
  });

  describe("removeDefault", () => {
    test("removes an existing default", async () => {
      await Bun.write(configPath, JSON.stringify(SAMPLE_CONFIG));
      const mgr = makeManager();
      await mgr.removeDefault("proxmox");
      expect(mgr.resolve("anyone", "proxmox")).toBeNull();
    });

    test("throws when default does not exist", async () => {
      await Bun.write(configPath, "{}");
      const mgr = makeManager({ groups: {}, credentials: {}, defaults: {} });
      expect(mgr.removeDefault("nonexistent")).rejects.toThrow(CredentialManagerError);
    });
  });

  describe("groups", () => {
    test("addGroup creates a new group", async () => {
      await Bun.write(configPath, "{}");
      const mgr = makeManager({ groups: {}, credentials: {}, defaults: {} });
      await mgr.addGroup("team", ["alice", "bob"]);
      expect(mgr.getGroupMembers("team")).toEqual(["alice", "bob"]);
    });

    test("addGroup throws when group already exists", async () => {
      await Bun.write(configPath, JSON.stringify(SAMPLE_CONFIG));
      const mgr = makeManager();
      expect(mgr.addGroup("ai_agents", ["test"])).rejects.toThrow(CredentialManagerError);
    });

    test("addGroupMembers adds new members", async () => {
      await Bun.write(configPath, JSON.stringify(SAMPLE_CONFIG));
      const mgr = makeManager();
      await mgr.addGroupMembers("ai_agents", ["claude", "skippy"]);
      const members = mgr.getGroupMembers("ai_agents")!;
      expect(members).toContain("claude");
      // Should not duplicate skippy
      expect(members.filter((m: string) => m === "skippy").length).toBe(1);
    });

    test("addGroupMembers throws for nonexistent group", async () => {
      await Bun.write(configPath, "{}");
      const mgr = makeManager({ groups: {}, credentials: {}, defaults: {} });
      expect(mgr.addGroupMembers("nope", ["x"])).rejects.toThrow(CredentialManagerError);
    });

    test("removeGroupMembers removes specified members", async () => {
      await Bun.write(configPath, JSON.stringify(SAMPLE_CONFIG));
      const mgr = makeManager();
      await mgr.removeGroupMembers("ai_agents", ["bilby"]);
      const members = mgr.getGroupMembers("ai_agents")!;
      expect(members).not.toContain("bilby");
      expect(members).toContain("skippy");
    });

    test("removeGroup removes the group", async () => {
      await Bun.write(configPath, JSON.stringify(SAMPLE_CONFIG));
      const mgr = makeManager();
      await mgr.removeGroup("admins");
      expect(mgr.getGroupMembers("admins")).toBeNull();
    });

    test("removeGroup throws for nonexistent group", async () => {
      await Bun.write(configPath, "{}");
      const mgr = makeManager({ groups: {}, credentials: {}, defaults: {} });
      expect(mgr.removeGroup("nope")).rejects.toThrow(CredentialManagerError);
    });

    test("getGroupsForUser returns all groups containing the user", () => {
      const config: CredentialsConfig = {
        groups: {
          group_a: ["alice", "bob"],
          group_b: ["bob", "charlie"],
          group_c: ["alice"],
        },
        credentials: {},
        defaults: {},
      };
      const mgr = makeManager(config);
      expect(mgr.getGroupsForUser("bob").sort()).toEqual(["group_a", "group_b"]);
      expect(mgr.getGroupsForUser("nobody")).toEqual([]);
    });
  });

  describe("getConfig", () => {
    test("returns a deep clone", () => {
      const mgr = makeManager();
      const cfg = mgr.getConfig();
      cfg.groups.ai_agents!.push("hacked");
      expect(mgr.getGroupMembers("ai_agents")!.length).toBe(3);
    });
  });

  describe("reloadFromDisk", () => {
    test("reloads updated config from disk", async () => {
      await Bun.write(configPath, JSON.stringify(SAMPLE_CONFIG));
      const mgr = makeManager();

      // Modify file on disk
      const updated = structuredClone(SAMPLE_CONFIG);
      updated.credentials.newUser = { svc: { headers: { X: "1" } } };
      await Bun.write(configPath, JSON.stringify(updated));

      await mgr.reloadFromDisk();
      expect(mgr.identityNames).toContain("newUser");
    });

    test("throws when file does not exist", async () => {
      const mgr = makeManager();
      expect(mgr.reloadFromDisk()).rejects.toThrow(CredentialManagerError);
    });

    test("throws on invalid config", async () => {
      await Bun.write(configPath, '{"groups": "bad"}');
      const mgr = makeManager();
      expect(mgr.reloadFromDisk()).rejects.toThrow(CredentialManagerError);
    });
  });
});
