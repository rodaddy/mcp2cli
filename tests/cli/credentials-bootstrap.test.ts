import { describe, expect, test } from "bun:test";
import { formatOpenBrainBootstrapSummary } from "../../src/cli/commands/credentials.ts";

describe("credentials bootstrap-open-brain", () => {
  test("summary omits bearer tokens", () => {
    const summary = formatOpenBrainBootstrapSummary(
      {
        item: "Open Brain - Per-User Tokens",
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
          identity: "skippy",
          service: "open-brain",
          credential: {
            headers: {
              Authorization: "Bearer skippy-secret-token",
            },
          },
        },
      ],
      ["skippy"],
      ["rico"],
    );

    const output = JSON.stringify(summary);
    expect(output).toContain('"changed":["skippy"]');
    expect(output).toContain('"skipped":["rico"]');
    expect(output).toContain('"discovered":["rico","skippy"]');
    expect(output).not.toContain("rico-secret-token");
    expect(output).not.toContain("skippy-secret-token");
    expect(output).not.toContain("Bearer");
  });
});
