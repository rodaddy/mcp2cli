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

if (params.query === "slow") {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  console.log(JSON.stringify({ success: true, result: "too-late" }));
  process.exit(0);
}

console.error("missing fixture");
process.exit(1);
