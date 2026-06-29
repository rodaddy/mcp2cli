const paramsIndex = Bun.argv.indexOf("--params");
const paramsRaw = paramsIndex >= 0 ? Bun.argv[paramsIndex + 1] : "{}";
const params = JSON.parse(paramsRaw ?? "{}") as { query?: string };

if (params.query === "fixture") {
  console.log(JSON.stringify({
    success: true,
    result: {
      fields: {
        token: "fixture-token",
      },
    },
  }));
  process.exit(0);
}

// Resolve to a sentinel token ONLY if this spawned child saw MCP2CLI_DAEMON
// cleared. If it is still "1" (the resolver failed to clear the daemon's env),
// return a value that makes the assertion fail -- mirroring the real bug where
// the child would boot a daemon instead of resolving. See refs.ts.
if (params.query === "daemon-env-check") {
  const cleared = process.env.MCP2CLI_DAEMON !== "1";
  console.log(JSON.stringify({
    success: true,
    result: {
      fields: {
        token: cleared ? "resolved-not-as-daemon" : "BOOTED-AS-DAEMON",
      },
    },
  }));
  process.exit(0);
}

if (params.query === "slow") {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  console.log(JSON.stringify({ success: true, result: "too-late" }));
  process.exit(0);
}

console.error("missing fixture");
process.exit(1);
