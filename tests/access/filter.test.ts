import { describe, expect, test } from "bun:test";
import {
  globToRegex,
  checkToolAccess,
  filterTools,
  extractPolicy,
} from "../../src/access/index.ts";
import type { AccessPolicy } from "../../src/access/index.ts";

// -- globToRegex --

describe("globToRegex", () => {
  test("exact match", () => {
    const re = globToRegex("list_workflows");
    expect(re.test("list_workflows")).toBe(true);
    expect(re.test("list_workflow")).toBe(false);
    expect(re.test("list_workflowss")).toBe(false);
  });

  test("wildcard * matches any characters", () => {
    const re = globToRegex("list_*");
    expect(re.test("list_workflows")).toBe(true);
    expect(re.test("list_nodes")).toBe(true);
    expect(re.test("list_")).toBe(true);
    expect(re.test("get_workflows")).toBe(false);
  });

  test("wildcard * at start", () => {
    const re = globToRegex("*_workflows");
    expect(re.test("list_workflows")).toBe(true);
    expect(re.test("get_workflows")).toBe(true);
    expect(re.test("workflows")).toBe(false);
  });

  test("wildcard ? matches single character", () => {
    const re = globToRegex("tool_?");
    expect(re.test("tool_a")).toBe(true);
    expect(re.test("tool_b")).toBe(true);
    expect(re.test("tool_ab")).toBe(false);
    expect(re.test("tool_")).toBe(false);
  });

  test("combined * and ?", () => {
    const re = globToRegex("n8n_*_workflow?");
    expect(re.test("n8n_list_workflows")).toBe(true);
    expect(re.test("n8n_get_workflowX")).toBe(true);
    expect(re.test("n8n_list_workflowXY")).toBe(false);
  });

  test("empty pattern matches empty string only", () => {
    const re = globToRegex("");
    expect(re.test("")).toBe(true);
    expect(re.test("anything")).toBe(false);
  });

  test("escapes regex special characters", () => {
    const re = globToRegex("tool.name");
    expect(re.test("tool.name")).toBe(true);
    expect(re.test("toolXname")).toBe(false); // . should not be regex wildcard
  });
});

// -- checkToolAccess --

describe("checkToolAccess", () => {
  test("allows tool when no policy is set", () => {
    const result = checkToolAccess("any_tool", {});
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("allows tool matching allowTools pattern", () => {
    const policy: AccessPolicy = { allowTools: ["list_*"] };
    const result = checkToolAccess("list_workflows", policy);
    expect(result.allowed).toBe(true);
  });

  test("blocks tool not matching allowTools pattern", () => {
    const policy: AccessPolicy = { allowTools: ["list_*"] };
    const result = checkToolAccess("delete_workflows", policy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not in the allowTools list");
  });

  test("blocks tool matching blockTools pattern", () => {
    const policy: AccessPolicy = { blockTools: ["delete_*"] };
    const result = checkToolAccess("delete_workflows", policy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("blocked by policy");
  });

  test("allows tool not matching blockTools pattern", () => {
    const policy: AccessPolicy = { blockTools: ["delete_*"] };
    const result = checkToolAccess("list_workflows", policy);
    expect(result.allowed).toBe(true);
  });

  test("allowTools + blockTools: allow first, then block", () => {
    const policy: AccessPolicy = {
      allowTools: ["n8n_*"],
      blockTools: ["n8n_delete_*"],
    };
    // Passes allow, not blocked
    expect(checkToolAccess("n8n_list_workflows", policy).allowed).toBe(true);
    // Passes allow but blocked
    expect(checkToolAccess("n8n_delete_workflow", policy).allowed).toBe(false);
    // Fails allow
    expect(checkToolAccess("other_tool", policy).allowed).toBe(false);
  });

  test("empty allowTools array passes all through", () => {
    const policy: AccessPolicy = { allowTools: [] };
    const result = checkToolAccess("any_tool", policy);
    expect(result.allowed).toBe(true);
  });

  test("empty blockTools array blocks nothing", () => {
    const policy: AccessPolicy = { blockTools: [] };
    const result = checkToolAccess("any_tool", policy);
    expect(result.allowed).toBe(true);
  });
});

// -- filterTools --

describe("filterTools", () => {
  const tools = [
    { name: "list_workflows", description: "List workflows" },
    { name: "get_workflow", description: "Get workflow" },
    { name: "delete_workflow", description: "Delete workflow" },
    { name: "create_workflow", description: "Create workflow" },
    { name: "list_nodes", description: "List nodes" },
  ];

  test("allowTools only (whitelist)", () => {
    const policy: AccessPolicy = { allowTools: ["list_*"] };
    const filtered = filterTools(tools, policy);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.name)).toEqual(["list_workflows", "list_nodes"]);
  });

  test("blockTools only (blacklist)", () => {
    const policy: AccessPolicy = { blockTools: ["delete_*"] };
    const filtered = filterTools(tools, policy);
    expect(filtered).toHaveLength(4);
    expect(filtered.map((t) => t.name)).not.toContain("delete_workflow");
  });

  test("both allowTools and blockTools", () => {
    const policy: AccessPolicy = {
      allowTools: ["*_workflow", "*_workflows"],
      blockTools: ["delete_*"],
    };
    const filtered = filterTools(tools, policy);
    expect(filtered).toHaveLength(3);
    const names = filtered.map((t) => t.name);
    expect(names).toContain("list_workflows");
    expect(names).toContain("get_workflow");
    expect(names).toContain("create_workflow");
    expect(names).not.toContain("delete_workflow");
    expect(names).not.toContain("list_nodes");
  });

  test("no policy (passes all through)", () => {
    const filtered = filterTools(tools, {});
    expect(filtered).toHaveLength(5);
  });

  test("empty arrays (passes all through)", () => {
    const filtered = filterTools(tools, { allowTools: [], blockTools: [] });
    expect(filtered).toHaveLength(5);
  });

  test("preserves extra properties on tool objects", () => {
    const richTools = [
      { name: "tool_a", description: "A", extra: 42 },
      { name: "tool_b", description: "B", extra: 99 },
    ];
    const policy: AccessPolicy = { allowTools: ["tool_a"] };
    const filtered = filterTools(richTools, policy);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.extra).toBe(42);
  });

  test("empty tool list returns empty", () => {
    const policy: AccessPolicy = { allowTools: ["*"] };
    const filtered = filterTools([], policy);
    expect(filtered).toHaveLength(0);
  });
});

// -- extractPolicy --

describe("extractPolicy", () => {
  test("extracts allowTools and blockTools from config", () => {
    const config = {
      allowTools: ["list_*"],
      blockTools: ["delete_*"],
    };
    const policy = extractPolicy(config);
    expect(policy.allowTools).toEqual(["list_*"]);
    expect(policy.blockTools).toEqual(["delete_*"]);
  });

  test("handles missing fields", () => {
    const policy = extractPolicy({});
    expect(policy.allowTools).toBeUndefined();
    expect(policy.blockTools).toBeUndefined();
  });

  test("handles partial config (only allowTools)", () => {
    const policy = extractPolicy({ allowTools: ["*"] });
    expect(policy.allowTools).toEqual(["*"]);
    expect(policy.blockTools).toBeUndefined();
  });
});
