import { describe, expect, test } from "bun:test";
import {
  buildOpenBrainCredentialsFromVaultwarden,
  normalizeOpenBrainToken,
} from "../../src/credentials/index.ts";

describe("Open Brain credential bootstrap", () => {
  test("maps Vaultwarden AUTH_TOKEN_USER fields to per-identity credentials", () => {
    const result = buildOpenBrainCredentialsFromVaultwarden({
      fields: {
        AUTH_TOKEN_USER_RICO: "admin:rico-token",
        AUTH_TOKEN_USER_SCOUT: "agent:scout-token",
        AUTH_TOKEN_USER_BUILDER: "builder-token",
        notes: "not a token",
      },
    });

    expect(result).toEqual([
      {
        identity: "builder",
        service: "open-brain",
        credential: { headers: { Authorization: "Bearer builder-token" } },
      },
      {
        identity: "rico",
        service: "open-brain",
        credential: { headers: { Authorization: "Bearer rico-token" } },
      },
      {
        identity: "scout",
        service: "open-brain",
        credential: { headers: { Authorization: "Bearer scout-token" } },
      },
    ]);
  });

  test("supports Bitwarden-style field arrays and custom service names", () => {
    const result = buildOpenBrainCredentialsFromVaultwarden(
      {
        fields: [
          { name: "AUTH_TOKEN_USER_SAM", value: "admin:sam-token" },
          { name: "AUTH_TOKEN_USER_ALEX", value: "admin:alex-token" },
        ],
      },
      { serviceName: "open-brain-staging" },
    );

    expect(result.map((entry) => [entry.identity, entry.service])).toEqual([
      ["alex", "open-brain-staging"],
      ["sam", "open-brain-staging"],
    ]);
  });

  test("normalizes role-prefixed Open Brain tokens", () => {
    expect(normalizeOpenBrainToken("admin:secret")).toBe("secret");
    expect(normalizeOpenBrainToken("agent:secret")).toBe("secret");
    expect(normalizeOpenBrainToken("plain-secret")).toBe("plain-secret");
    expect(normalizeOpenBrainToken("")).toBeNull();
  });
});
