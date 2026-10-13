import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const PROBE = "scripts/done-means/no-connection-module-mocks.probe.ts";
const invoke = (args: string[]) => spawnSync(process.execPath, [PROBE, ...args], {
  cwd: ROOT, encoding: "utf8",
});
const list = (args: string[]): string[] => {
  const r = invoke([...args, "--list"]);
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
};

// RED receipts: the old CLI ignored invalid shards; mutating the modulo to
// select the same cases for every shard fails the disjoint-union assertion.
test("shards partition the full CLI inventory exactly once, including special cases", () => {
  const all = list([]);
  expect(new Set(all).size).toBe(all.length);
  expect(all).toContain("plain mock.module() call");
  expect(all).toContain("symlink OUTSIDE the repo -- reported, never silent");
  expect(all).toContain("SCOPE: violation outside tests/ -- the repo is the scan root");
  expect(all).toContain("guard/check protected lists agree");
  expect(list(["--shard", "1", "--shards", "1"])).toEqual(all);
  for (const count of [2, 3, 4, all.length]) {
    const shards = Array.from({ length: count }, (_, i) =>
      list(["--shard", String(i + 1), "--shards", String(count)]));
    const union = shards.flat();
    expect(union.length).toBe(all.length);
    expect(new Set(union).size).toBe(all.length);
    expect([...union].sort()).toEqual([...all].sort());
    expect(Math.max(...shards.map((s) => s.length)) - Math.min(...shards.map((s) => s.length))).toBeLessThanOrEqual(1);
  }
});

test("malformed shard options fail closed before running any cases", () => {
  const invalid = [
    ["--shard", "1"], ["--shards", "4"], ["--unknown"], ["extra"],
    ["--shard", "1", "--shard", "2", "--shards", "4"],
    ["--shard", "1", "--shards", "4", "--shards", "4"],
    ["--list", "--list"], ["--shard", "1", "--shards", "105"],
    ["--shard", "5", "--shards", "4"],
    ...["0", "-1", "1.5", "1x", "", "01", "NaN", "Infinity", "9007199254740993"].flatMap((value) => [
      ["--shard", value, "--shards", "4"],
      ["--shard", "1", "--shards", value],
    ]),
  ];
  for (const args of invalid) {
    const r = invoke(args);
    expect(r.status).toBe(3);
    expect(r.stdout).toContain("HARNESS:");
    expect(r.stdout).not.toContain("probes behaved as specified");
  }
});
