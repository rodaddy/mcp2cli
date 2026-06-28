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
        AUTH_TOKEN_USER_SKIPPY: "agent:skippy-token",
        AUTH_TOKEN_USER_BILBY: "bilby-token",
        notes: "not a token",
      },
    });

    expect(result).toEqual([
      {
        identity: "bilby",
        service: "open-brain",
        credential: { headers: { Authorization: "Bearer bilby-token" } },
      },
      {
        identity: "rico",
        service: "open-brain",
        credential: { headers: { Authorization: "Bearer rico-token" } },
      },
      {
        identity: "skippy",
        service: "open-brain",
        credential: { headers: { Authorization: "Bearer skippy-token" } },
      },
    ]);
  });

  test("supports Bitwarden-style field arrays and custom service names", () => {
    const result = buildOpenBrainCredentialsFromVaultwarden(
      {
        fields: [
          { name: "AUTH_TOKEN_USER_GEETESH", value: "admin:geetesh-token" },
          { name: "AUTH_TOKEN_USER_KEVIN", value: "admin:kevin-token" },
        ],
      },
      { serviceName: "open-brain-staging" },
    );

    expect(result.map((entry) => [entry.identity, entry.service])).toEqual([
      ["geetesh", "open-brain-staging"],
      ["kevin", "open-brain-staging"],
    ]);
  });

  test("normalizes role-prefixed Open Brain tokens", () => {
    expect(normalizeOpenBrainToken("admin:secret")).toBe("secret");
    expect(normalizeOpenBrainToken("agent:secret")).toBe("secret");
    expect(normalizeOpenBrainToken("plain-secret")).toBe("plain-secret");
    expect(normalizeOpenBrainToken("")).toBeNull();
  });
});
