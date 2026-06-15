import { describe, expect, test } from "bun:test";
import { createMcpClient } from "../../src/connection/capabilities.ts";

interface ClientInternals {
  _capabilities?: {
    elicitation?: object;
  };
}

describe("createMcpClient", () => {
  test("declares elicitation client capabilities", () => {
    const client = createMcpClient();
    const internals = client as unknown as ClientInternals;

    expect(internals._capabilities?.elicitation).toEqual({});
  });
});
