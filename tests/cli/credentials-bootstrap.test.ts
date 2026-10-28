import { describe, expect, test } from "bun:test";
import { formatOpenBrainBootstrapSummary } from "../../src/cli/commands/credentials.ts";

describe("credentials bootstrap-open-brain", () => {
  test("summary omits bearer tokens", () => {
    const summary = formatOpenBrainBootstrapSummary(
      {
        item: "mcp2cli-user-tokens",
        service: "open-brain",
      },
      [
        {
          identity: "rico",
          service: "open-brain",
          credential: {
            headers: {
              Authorization: "Bearer rico-secret-token",
            },
          },
        },
        {
          identity: "scout",
          service: "open-brain",
          credential: {
            headers: {
              Authorization: "Bearer scout-secret-token",
            },
          },
        },
      ],
      ["scout"],
      ["rico"],
    );

    const output = JSON.stringify(summary);
    expect(output).toContain('"changed":["scout"]');
    expect(output).toContain('"skipped":["rico"]');
    expect(output).toContain('"discovered":["rico","scout"]');
    expect(output).not.toContain("rico-secret-token");
    expect(output).not.toContain("scout-secret-token");
    expect(output).not.toContain("Bearer");
  });
});
