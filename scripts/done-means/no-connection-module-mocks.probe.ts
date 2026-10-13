/**
 * PROBES for no-connection-module-mocks.ts -- the regression suite for the
 * gate itself.
 *
 *   bun scripts/done-means/no-connection-module-mocks.probe.ts
 *   bun scripts/done-means/no-connection-module-mocks.probe.ts --shard 1 --shards 4
 *
 * Shards are 1-based and MUST run in independent checkouts/containers, never
 * concurrently in one tree. --list prints the selected case names without
 * touching the tree; no arguments still runs every case.
 *
 * Exit grammar matches the check it probes: 0 all probes behaved, 1 at least
 * one did not, 3 the probes could not run.
 *
 * WHY THIS EXISTS. The check went through six adversarial review rounds and
 * every one found a real defect -- twice a defect the PREVIOUS round's fix had
 * introduced. Parameter shadowing alone was wrong four times running: scoped
 * by name across the whole file, then spanning the parameter list where the
 * outer binding is still live, then reading only simple identifiers, then
 * knowing nothing of catch/for-of/block bindings. Each fix was verified by
 * hand and each hand-verification was thrown away, so the next round had to
 * rediscover the boundary. These probes are that verification, kept.
 *
 * HOW THEY WORK, and why they are not a bun test. The check takes no arguments
 * and scans the repo it lives in, because CI runs a bare `bun test` and a
 * check that inspects a subset of what runs has a silent hole. Probing it
 * therefore means writing a file into the repo, running the check as CI runs
 * it, and removing the file. That is inherently serial and mutates the working
 * tree, so it is a script rather than a test file -- and it never runs under
 * `bun test`, where a half-written probe would be discovered as a test.
 *
 * Every probe asserts a DIRECTION, not just an exit code: a suppression probe
 * is paired with a bypass probe that adds a real escape, so a fix that
 * silences a false positive by disabling detection fails here immediately.
 * That pairing is what caught the file-scoped shadowing bug.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const CHECK = resolve(import.meta.dir, "no-connection-module-mocks.ts");
/** Probe files live in the repo because the check scans the repo. */
const TESTS = resolve(REPO_ROOT, "tests");
const DIR = resolve(TESTS, "_probe_done_means");
/**
 * A SECOND probe root outside tests/. Every probe above writes into tests/, so
 * all of them stayed green when SCAN_ROOT was mutated from the repo root to
 * tests/ -- the suite could not see the check's most basic contract, which
 * round 2 established after a violation in src/ passed while the file count
 * looked healthy. A probe that lives outside tests/ is what makes that
 * mutation visible.
 */
const OUTSIDE_TESTS = resolve(REPO_ROOT, "_probe_scope_done_means");
/** Outside-the-repo fixtures use run-owned scratch, or the configured host workspace. */
const SCRATCH_ROOT =
  process.env.PAPERCLIP_RUN_SCRATCH_DIR ??
  process.env.PAPERCLIP_SCRATCH_DIR ??
  process.env.RUNNER_TEMP ??
  tmpdir();
const OUTSIDE = resolve(SCRATCH_ROOT, "mcp2cli/_scratch", `_probe_link_target-${randomUUID()}`);

/** A file that patches a forbidden transport module. */
const POISON = (target: string) =>
  `import { mock } from "bun:test";\n` +
  `mock.module(${JSON.stringify(target)}, () => ({}));\n` +
  `export const h = 1;\n`;

/** Preamble that makes `mock` a REAL tracked binding. Several false positives
 *  only reproduce when the file genuinely imports it. */
const HEAD = `import { mock, test, expect } from "bun:test";\nconst spy = mock(() => 1);\n`;
const TAIL = `test("t", () => expect(String(spy())).toBe("1"));\n`;
/** A genuine escaped reference, appended to turn a suppression probe into a
 *  bypass probe. If shadowing is too broad, this stops being reported. */
const ESCAPE =
  `const __a = [mock.module];\n` +
  `__a[0]("../../src/connection/connect.ts", () => ({}));\n`;

type Probe = {
  name: string;
  want: 0 | 1 | 3;
  files: Record<string, string>;
  /**
   * A substring the check's output must contain. Without it a probe only
   * asserts THAT the check failed, and a probe can then pass for a reason
   * nobody intended -- mutation testing found two that did, staying green
   * while the behaviour they were written to pin was deleted.
   */
  expect?: string;
};

/** Both directions of one shadowing construct: suppressed, and still caught. */
const shadowPair = (name: string, body: string): Probe[] => [
  { name: `${name} -- suppressed`, want: 0, files: { "probe.test.ts": HEAD + body + TAIL } },
  { name: `${name} -- real escape still caught`, want: 1, files: { "probe.test.ts": HEAD + body + ESCAPE + TAIL } },
];

const PROBES: Probe[] = [
  // ---- direct and aliased calls: the spellings the check was built for ----
  {
    name: "plain mock.module() call",
    want: 1,
    files: { "probe.test.ts": `import { mock, test } from "bun:test";\nmock.module("../../src/connection/connect.ts", () => ({}));\ntest("t", () => {});\n` },
  },
  {
    name: "aliased namespace: const m = mock",
    want: 1,
    files: { "probe.test.ts": `import { mock, test } from "bun:test";\nconst m = mock;\nm.module("../../src/daemon/transports.ts", () => ({}));\ntest("t", () => {});\n` },
  },
  {
    name: "captured function: Reflect.apply on a learned alias",
    want: 1,
    files: { "probe.test.ts": `import { mock, test } from "bun:test";\nconst patch = mock.module;\nReflect.apply(patch, null, ["../../src/daemon/pool.ts", () => ({})]);\ntest("t", () => {});\n` },
  },
  { name: "clean file", want: 0, files: { "probe.test.ts": `import { test, expect } from "bun:test";\ntest("t", () => expect(1).toBe(1));\n` } },

  // ---- shadowing: every binding construct, both directions ----
  ...shadowPair("parameter", `function render(mock: { module: string }) { return mock.module; }\nvoid render({module:"x"});\n`),
  ...shadowPair("arrow parameter", `const r = (mock: { module: string }) => mock.module;\nvoid r({module:"x"});\n`),
  ...shadowPair("class method parameter", `class R { go(mock: { module: string }) { return mock.module; } }\nvoid new R().go({module:"x"});\n`),
  ...shadowPair("destructured parameter", `function render({ mock }: { mock: { module: string } }) { return mock.module; }\nvoid render({mock:{module:"x"}});\n`),
  ...shadowPair("renamed destructure", `function render({ m: mock }: { m: { module: string } }) { return mock.module; }\nvoid render({m:{module:"x"}});\n`),
  ...shadowPair("array destructure", `function render([mock]: { module: string }[]) { return mock.module; }\nvoid render([{module:"x"}]);\n`),
  ...shadowPair("array destructure with a hole", `function render([, mock]: { module: string }[]) { return mock.module; }\nvoid render([{module:"z"},{module:"x"}]);\n`),
  ...shadowPair("nested destructure", `function render({ o: { mock } }: { o: { mock: { module: string } } }) { return mock.module; }\nvoid render({o:{mock:{module:"x"}}});\n`),
  ...shadowPair("rest parameter", `function render(...mock: { module: string }[]) { return mock[0].module; }\nvoid render({module:"x"});\n`),
  ...shadowPair("object rest", `function render({ ...mock }: { module: string }) { return mock.module; }\nvoid render({module:"x"});\n`),
  ...shadowPair("catch clause", `try { throw {module:"x"}; } catch (mock: any) { void mock.module; }\n`),
  ...shadowPair("destructured catch", `try { throw {mock:{module:"x"}}; } catch ({ mock }: any) { void mock.module; }\n`),
  ...shadowPair("for-of binding", `for (const mock of [{module:"x"}]) { void mock.module; }\n`),
  ...shadowPair("destructured for-of", `for (const { mock } of [{mock:{module:"x"}}]) { void mock.module; }\n`),
  ...shadowPair("for-in binding", `for (const mock in {a:1}) { void (mock as any).module; }\n`),
  ...shadowPair("for-initializer let", `for (let mock = {module:1}; false; ) { void mock.module; }\n`),
  ...shadowPair("block-local const", `{ const mock = { module: 1 }; void mock.module; }\n`),
  ...shadowPair("function-local const", `function f() { const mock = { module: 1 }; return mock.module; }\nvoid f();\n`),
  ...shadowPair("function-local var", `function g() { var mock = { module: 1 }; return mock.module; }\nvoid g();\n`),
  ...shadowPair("generator parameter", `function* gen(mock: { module: string }) { yield mock.module; }\nvoid [...gen({module:"x"})];\n`),

  // Nested scopes: an inner shadow must not silence an outer read, and an
  // inner read must stay silenced by an outer shadow.
  {
    name: "nested: inner shadow, OUTER escape still caught",
    want: 1,
    files: { "probe.test.ts": `import { mock, test } from "bun:test";\nconst arr = [mock.module];\nfunction outer() { function inner(mock: { module: string }) { return mock.module; } void inner({module:"x"}); }\nouter(); arr[0]("../../src/connection/connect.ts", () => ({}));\ntest("t", () => {});\n` },
  },
  {
    name: "nested: outer shadow silences an inner read",
    want: 0,
    files: { "probe.test.ts": `import { test, expect } from "bun:test";\nfunction outer(mock: { module: string }) { const inner = () => [mock.module]; return inner()[0]; }\ntest("t", () => expect(outer({module:"x"})).toBe("x"));\n` },
  },
  {
    name: "parameter default reads the OUTER mock -- not suppressed",
    want: 1,
    files: { "probe.test.ts": `import { mock, test } from "bun:test";\nfunction evil(x = mock.module, mock?: any) { void mock; return [x]; }\nevil()[0]("../../src/connection/connect.ts", () => ({}));\ntest("t", () => {});\n` },
  },
  {
    name: "shadowed twice, escape between the two functions",
    want: 1,
    files: { "probe.test.ts": `import { mock, test } from "bun:test";\nfunction a(mock: { module: string }) { return mock.module; }\nconst arr = [mock.module];\nfunction b(mock: { module: string }) { return mock.module; }\narr[0]("../../src/daemon/transports.ts", () => ({}));\ntest("t", () => { a({module:"x"}); b({module:"y"}); });\n` },
  },

  // ---- import closure: a helper the runner loads is judged like a test ----
  {
    name: "imported helper poisons -- caught",
    want: 1,
    files: {
      "h/helper.ts": POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test } from "bun:test";\nimport { h } from "./h/helper.ts";\ntest("t", () => { void h; });\n`,
    },
  },
  {
    name: "UNIMPORTED file with the same content -- correctly ignored",
    want: 0,
    files: {
      "h/helper.ts": POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test, expect } from "bun:test";\ntest("t", () => expect(1).toBe(1));\n`,
    },
  },
  // NodeNext specifiers name the EMITTED file; appending extensions can only
  // produce helper.js.ts, so these were silently unresolved.
  ...(
    [
      [".js", "h/helper.ts"],
      [".jsx", "h/helper.tsx"],
      [".mjs", "h/helper.mts"],
      [".cjs", "h/helper.cts"],
    ] as const
  ).map(([ext, onDisk]): Probe => ({
    name: `${ext} specifier resolving to ${onDisk.split("/")[1]}`,
    want: 1,
    files: {
      [onDisk]: POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test } from "bun:test";\nimport { h } from "./h/helper${ext}";\ntest("t", () => { void h; });\n`,
    },
  })),

  // ---- namespace acquisition: how `mock` got here does not matter ----
  {
    name: "computed property: mock[\"mod\" + \"ule\"]",
    want: 1,
    files: { "probe.test.ts": `import { mock, test } from "bun:test";\nconst p = mock["mod" + "ule"];\np("../../src/daemon/pool.ts", () => ({}));\ntest("t", () => {});\n` },
  },
  {
    name: "import bt = require(\"bun:test\")",
    want: 1,
    files: { "probe.test.ts": `import bt = require("bun:test");\nbt.mock.module("../../src/daemon/pool.ts", () => ({}));\nbt.test("t", () => {});\n` },
  },
  {
    name: "aliased require: const req = require",
    want: 1,
    files: { "probe.test.ts": `import { test } from "bun:test";\nconst req = require;\nconst bt = req("bun:test");\nbt.mock.module("../../src/daemon/pool.ts", () => ({}));\ntest("t", () => {});\n` },
  },
  {
    // The overcorrection behind the alias fix: accepting ANY callee whose
    // sole argument is "bun:test" read an ordinary function that takes a
    // module id as bun's namespace, and failed a build on a file with no
    // mock in it at all. The callee must be a module FETCHER.
    name: "ordinary function taking \"bun:test\" -- not the namespace",
    want: 0,
    files: {
      "probe.test.ts": `import { test, expect } from "bun:test";\nconst specs: Record<string, { mock: { module: string } }> = {};\nfunction register(id: string) { specs[id] = { mock: { module: id } }; return specs[id]!; }\nconst entry = register("bun:test");\ntest("t", () => { expect(entry.mock.module).toBe("bun:test"); });\n`,
    },
  },
  {
    // The closure edge for the same spelling seeded at the call site. A
    // helper reachable ONLY via `import h = require(...)` was never followed,
    // so its mock.module() was never read: exit 0 with the pool registry
    // replaced, proven in a real `bun test` run.
    name: "import-equals as a closure edge -- helper still followed",
    want: 1,
    expect: "h/poison.ts",
    files: {
      "h/poison.ts": POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test } from "bun:test";\nimport h = require("./h/poison.ts");\ntest("t", () => { void h; });\n`,
    },
  },
  {
    // A catch binding is a VariableDeclaration parented by the CatchClause,
    // so the redeclaration test counted it and an UNRELATED `catch (pkg)`
    // anywhere in the file made a correct `import(pkg)` undecidable.
    name: "unrelated catch shadow -- dynamic specifier still resolves",
    want: 0,
    files: {
      "probe.test.ts": `import { test, expect } from "bun:test";\nconst pkg = "node:path";\ntest("a", async () => { expect(await import(pkg)).toBeDefined(); });\ntest("b", () => { try { throw new Error("x"); } catch (pkg) { void pkg; } });\n`,
    },
  },
  {
    name: "catch shadow CONTAINING the import -- still undecidable",
    want: 1,
    files: {
      "probe.test.ts": `import { test } from "bun:test";\nconst pkg = "node:path";\ntest("a", async () => { try { throw new Error("x"); } catch (pkg) { await import(pkg as any); } });\n`,
    },
  },
  {
    name: "destructured OUT of a wrapper object",
    want: 1,
    files: { "probe.test.ts": `import { mock, test } from "bun:test";\nconst w = { mock };\nconst { mock: m } = w;\nm.module("../../src/daemon/pool.ts", () => ({}));\ntest("t", () => {});\n` },
  },
  {
    name: "unrelated fn taking the string \"bun:test\" -- not a namespace",
    want: 0,
    files: { "probe.test.ts": `import { test, expect } from "bun:test";\nconst label = (s: string) => s.length;\nconst n = label("bun:test");\ntest("t", () => expect(n).toBe(8));\n` },
  },

  // ---- directory imports: package.json "main" beats index.* ----
  {
    name: "directory import via package.json main -- followed, poison caught",
    want: 1,
    // Pinned to the CLAUSE, not just the exit code. Without packageMain() the
    // import resolves to nothing and the unresolved-import report fails the
    // run for a different reason -- so an exit-code-only probe stayed green
    // with the resolution deleted. It must be found IN the helper.
    expect: "h/poison.ts",
    files: {
      "h/package.json": `{ "name": "h", "main": "poison.ts" }\n`,
      "h/poison.ts": POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test } from "bun:test";\nimport { h } from "./h";\ntest("t", () => { void h; });\n`,
    },
  },
  {
    name: "directory import via index.ts -- still followed",
    want: 1,
    files: {
      "h/index.ts": POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test } from "bun:test";\nimport { h } from "./h";\ntest("t", () => { void h; });\n`,
    },
  },
  {
    // "main" is a SPECIFIER: bun appends extensions to it. Resolving it by
    // exact path returned undefined here, the caller fell through to its own
    // `h/index.ts` candidate, and that SUCCEEDED -- so the import counted as
    // followed while the check read the decoy and bun ran the poison. Exit 0
    // with the pool registry replaced, verified in a real `bun test`.
    name: "extensionless main beside a decoy index -- poison still caught",
    want: 1,
    expect: "h/poison.ts",
    files: {
      "h/package.json": `{ "name": "h", "main": "poison" }\n`,
      "h/poison.ts": POISON("../../../src/daemon/pool.ts"),
      "h/index.ts": `export const h = "decoy";\n`,
      "probe.test.ts": `import { test } from "bun:test";\nimport { h } from "./h";\ntest("t", () => { void h; });\n`,
    },
  },
  {
    // The ordering half of the same defect: "main" was appended AFTER the
    // index candidates, so a resolvable main lost to an index file that bun
    // never loads. Clean main, poisoned decoy -- the check must read neither
    // the decoy nor nothing, it must read main and pass.
    name: "main beats a poisoned index.ts -- the decoy is never read",
    want: 0,
    files: {
      "h/package.json": `{ "name": "h", "main": "real.ts" }\n`,
      "h/real.ts": `export const h = 1;\n`,
      "h/index.ts": POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test } from "bun:test";\nimport { h } from "./h";\ntest("t", () => { void h; });\n`,
    },
  },
  {
    name: "relative import resolving to nothing -- reported, never dropped",
    want: 1,
    files: { "probe.test.ts": `import { test } from "bun:test";\n// @ts-ignore -- deliberately unresolvable\nimport { h } from "./nowhere/at/all";\ntest("t", () => { void h; });\n` },
  },

  // ---- type-only imports are erased, so bun never loads them ----
  {
    name: "import type { H } -- erased, helper never loads",
    want: 0,
    files: {
      "h/helper.ts": `import { mock } from "bun:test";\nmock.module("../../../src/daemon/pool.ts", () => ({}));\nexport const h = 1;\nexport type H = number;\n`,
      "probe.test.ts": `import { test, expect } from "bun:test";\nimport type { H } from "./h/helper.ts";\nexport type X = H;\ntest("t", () => expect(1).toBe(1));\n`,
    },
  },
  {
    name: "import { type H } -- every binding type-only, erased",
    want: 0,
    files: {
      "h/helper.ts": `import { mock } from "bun:test";\nmock.module("../../../src/daemon/pool.ts", () => ({}));\nexport const h = 1;\nexport type H = number;\n`,
      "probe.test.ts": `import { test, expect } from "bun:test";\nimport { type H } from "./h/helper.ts";\nexport type X = H;\ntest("t", () => expect(1).toBe(1));\n`,
    },
  },
  {
    name: "import {} from -- LOADS despite binding nothing (measured)",
    want: 1,
    expect: "h/helper.ts",
    files: {
      "h/helper.ts": `import { mock } from "bun:test";\nmock.module("../../../src/daemon/pool.ts", () => ({}));\nexport const h = 1;\n`,
      "probe.test.ts": `import { test, expect } from "bun:test";\nimport {} from "./h/helper.ts";\ntest("t", () => expect(1).toBe(1));\n`,
    },
  },
  {
    name: "mixed value + type import -- loads",
    want: 1,
    expect: "h/helper.ts",
    files: {
      "h/helper.ts": `import { mock } from "bun:test";\nmock.module("../../../src/daemon/pool.ts", () => ({}));\nexport const h = 1;\nexport type H = number;\n`,
      "probe.test.ts": `import { test } from "bun:test";\nimport { h, type H } from "./h/helper.ts";\nexport type X = H;\ntest("t", () => { void h; });\n`,
    },
  },

  // ---- a dynamic specifier's name must not be shadowed elsewhere ----
  {
    name: "dynamic specifier name shadowed by a parameter",
    want: 1,
    files: {
      "h/helper.ts": `import { mock } from "bun:test";\nmock.module("../../../src/daemon/pool.ts", () => ({}));\nexport const h = 1;\n`,
      "probe.test.ts": `import { test } from "bun:test";\nconst pkg = "node:path";\nfunction load(pkg: string) { return import(pkg); }\ntest("t", async () => { await load("./h/helper.ts"); });\n`,
    },
  },

  // ---- the fixtures parse hatch is for DATA, not for discovered tests ----
  {
    name: "unparseable fixture IMPORTED by a test -- skipped, as intended",
    want: 0,
    // The fixture must be IMPORTED. An unimported one is never walked (it does
    // not match bun's name pattern), so the hatch is never consulted and the
    // probe proves nothing -- mutation testing caught exactly that: deleting
    // the hatch left the earlier version of this probe green.
    files: {
      "fixtures/data.ts": `this is not valid typescript !!!\n`,
      "probe.test.ts": `import { test, expect } from "bun:test";\n// @ts-ignore -- deliberately unparseable fixture\nimport "./fixtures/data.ts";\ntest("t", () => expect(1).toBe(1));\n`,
    },
  },
  {
    name: "unparseable fixtures/*.test.ts -- bun RUNS it, so never skipped",
    want: 3,
    files: { "fixtures/poison.test.ts": `import { mock } from "bun:test";\nmock.module("../../../src/daemon/pool.ts", () => ({}));\nthis is not valid typescript !!!\n` },
  },

  // ---- the rule is unconditional: no allowlist at all ----
  {
    // daemon-schema-client was the ONE allowlisted target. That call was moved
    // onto the setDaemonSchemaClient() seam and the exemption is gone, so this
    // module is now judged like any other: not protected, so not an offence.
    // The probe that used to live here asserted the opposite, and was correct
    // until the allowlist clause it tested was deleted.
    name: "unprotected module mocked anywhere -- not this check's business",
    want: 0,
    files: { "dup.test.ts": `import { mock, test } from "bun:test";\nmock.module("../../src/cli/commands/daemon-schema-client.ts", () => ({}));\ntest("t", () => {});\n` },
  },
  {
    // The protected modules have no exemption to hide behind now, in any file.
    name: "protected module mocked in a second file -- still caught",
    want: 1,
    files: {
      "one.test.ts": `import { mock, test } from "bun:test";\nmock.module("../../src/daemon/transports.ts", () => ({}));\ntest("t", () => {});\n`,
      "two.test.ts": `import { mock, test } from "bun:test";\nmock.module("../../src/daemon/pool.ts", () => ({}));\ntest("t", () => {});\n`,
    },
  },

  // ---- percent-encoded specifiers still resolve to the forbidden module ----
  {
    name: "percent-encoded specifier",
    want: 1,
    files: { "probe.test.ts": `import { mock, test } from "bun:test";\nmock.module("../../src/daemon/%70ool.ts", () => ({}));\ntest("t", () => {});\n` },
  },

  // ---- dynamic imports: decidable ones followed, the rest reported ----
  {
    name: "const holding a bare specifier -- not ours to judge",
    want: 0,
    files: { "probe.test.ts": `import { test } from "bun:test";\nconst pkg = "node:path";\ntest("t", async () => { await import(pkg); });\n` },
  },
  {
    name: "const holding a RELATIVE path -- followed, poison caught",
    want: 1,
    files: {
      "h/helper.ts": POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test } from "bun:test";\nconst rel = "./h/helper.ts";\ntest("t", async () => { await import(rel); });\n`,
    },
  },
  {
    name: "template-literal specifier -- unresolvable, reported",
    want: 1,
    files: { "probe.test.ts": `import { test } from "bun:test";\nconst l = "en";\ntest("t", async () => { await import(\`./loc/\${l}.ts\`); });\n` },
  },
  {
    name: "reassigned specifier -- unresolvable, reported",
    want: 1,
    files: { "probe.test.ts": `import { test } from "bun:test";\nlet pkg = "node:path";\npkg = "node:fs";\ntest("t", async () => { await import(pkg); });\n` },
  },
  {
    // This probe used to assert want:1 on a NESTED redeclaration, which
    // encoded a false positive as desired behaviour: `function f() { const
    // pkg = ... }` is a different variable, and `import(pkg)` at module scope
    // decidably holds the outer literal. Verified against the runtime -- the
    // code passes `bun test` and imports node:path. A probe can be wrong in
    // the same direction the check is wrong, and pairing every suppression
    // with an escape probe is what keeps that from going unnoticed.
    name: "nested redeclaration -- outer specifier still decidable",
    want: 0,
    files: { "probe.test.ts": `import { test } from "bun:test";\nconst pkg = "node:path";\nfunction f() { const pkg = "node:fs"; return pkg; }\ntest("t", async () => { await import(pkg); void f(); });\n` },
  },
  {
    // The case the probe above was MEANT to cover: a redeclaration in the
    // SAME scope as the import, where which value reaches it is genuinely
    // undecidable.
    name: "specifier declared twice in one scope -- unresolvable, reported",
    want: 1,
    files: { "probe.test.ts": `import { test } from "bun:test";\nlet pkg = "node:path";\npkg = "node:fs";\ntest("t", async () => { await import(pkg); });\n` },
  },

  // ---- round 9: resolution, erasure, and anchoring ----
  {
    // An extensionless file has no extension to judge and bun runs it as
    // code. The data test (skip anything not .ts/.js/...) marked it resolved
    // and never parsed it: exit 0 with the pool registry replaced.
    name: "extensionless helper -- parsed, not treated as data",
    want: 1,
    expect: "h/helper",
    files: {
      "h/helper": POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test } from "bun:test";\nimport { h } from "./h/helper";\ntest("t", () => { void h; });\n`,
    },
  },
  {
    name: "imported .json -- still data, still not parsed",
    want: 0,
    files: {
      "data.json": `{"a":1}\n`,
      "probe.test.ts": `import { test, expect } from "bun:test";\nimport data from "./data.json";\ntest("t", () => { expect(data.a).toBe(1); });\n`,
    },
  },
  {
    // The closure followed only a literally-spelled require(...).
    name: "aliased require as a closure edge -- helper followed",
    want: 1,
    expect: "h/helper.ts",
    files: {
      "h/helper.ts": POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test } from "bun:test";\nconst req = require;\nconst m = req("./h/helper.ts");\ntest("t", () => { void m; });\n`,
    },
  },
  {
    // Declaration order must not matter: the seed runs to a fixed point.
    name: "reverse-order fetcher alias -- still a closure edge",
    want: 1,
    expect: "h/helper.ts",
    files: {
      "h/helper.ts": POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test } from "bun:test";\nconst outer = inner;\nconst inner = require;\nconst m = outer("./h/helper.ts");\ntest("t", () => { void m; });\n`,
    },
  },
  {
    // The alias fixed point counted only namespaces and functions, so a pass
    // that learned a FETCHER left the sum unchanged and the loop stopped one
    // pass early -- before that alias could yield the namespace.
    name: "reverse-order fetcher -> namespace -- loop runs to settle",
    want: 1,
    files: { "probe.test.ts": `import { test } from "bun:test";\nconst outer = inner;\nconst inner = require;\nconst bt = outer("bun:test");\nbt.mock.module("../../src/daemon/pool.ts", () => ({}));\ntest("t", () => {});\n` },
  },
  {
    // Exports have the same per-specifier type-only spelling imports do.
    name: "export { type H } from -- erased, not followed",
    want: 0,
    files: {
      "h/helper.ts": `import { mock } from "bun:test";\nmock.module("../../../src/daemon/pool.ts", () => ({}));\nexport const h = 1;\nexport type H = number;\n`,
      "probe.test.ts": `import { test } from "bun:test";\nexport { type H } from "./h/helper.ts";\ntest("t", () => {});\n`,
    },
  },
  {
    name: "export * from -- loads, still followed",
    want: 1,
    expect: "h/helper.ts",
    files: {
      "h/helper.ts": POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test } from "bun:test";\nexport * from "./h/helper.ts";\ntest("t", () => {});\n`,
    },
  },
  {
    name: "import type h = require() -- erased, not followed",
    want: 0,
    files: {
      "h/helper.ts": `import { mock } from "bun:test";\nmock.module("../../../src/daemon/pool.ts", () => ({}));\nexport const h = 1;\nexport type H = number;\n`,
      "probe.test.ts": `import { test, expect } from "bun:test";\nimport type h = require("./h/helper.ts");\ntest("t", () => { const x: h.H = 1; expect(x).toBe(1); });\n`,
    },
  },
  ...shadowPair(
    "local function named require",
    `function scope() {\n  const require = (id: string) => ({ id });\n  return require("./whatever");\n}\nvoid scope;\n`,
  ),
  {
    // The span is the point, again: dropping the fetcher name file-wide let
    // one decoy turn off the real require edge for the whole file.
    name: "decoy local require + real require edge -- edge survives",
    want: 1,
    expect: "h/helper.ts",
    files: {
      "h/helper.ts": POISON("../../../src/daemon/pool.ts"),
      "probe.test.ts": `import { test } from "bun:test";\nfunction scope() { const require = (id: string) => ({ id }); return require("./x"); }\nconst m = require("./h/helper.ts");\ntest("t", () => { void scope; void m; });\n`,
    },
  },
  {
    // isForbidden matched any path ending daemon/pool.ts, so a local fixture
    // that patches nothing real was rejected while bun test passed on it.
    name: "local fixture named daemon/pool.ts -- not the protected module",
    want: 0,
    files: {
      "fake/daemon/pool.ts": `export const notTheRealPool = true;\n`,
      "probe.test.ts": `import { test, expect, mock } from "bun:test";\nmock.module("./fake/daemon/pool.ts", () => ({ notTheRealPool: false }));\ntest("t", async () => { const m = await import("./fake/daemon/pool.ts"); expect(m.notTheRealPool).toBe(false); });\n`,
    },
  },
  {
    name: "real pool via .js spelling -- still anchored and caught",
    want: 1,
    files: { "probe.test.ts": `import { test, mock } from "bun:test";\nmock.module("../../src/daemon/pool.js", () => ({}));\ntest("t", () => {});\n` },
  },
];

/** Probes that need a symlink, which the plain file map cannot express. */
type LinkProbe = { name: string; want: 0 | 1; build: () => void };
/**
 * The same violations, written OUTSIDE tests/. CI runs a bare `bun test`,
 * which discovers a test file anywhere in the repo, so the check scans the
 * repo root -- and every probe above lives in tests/, which made the whole
 * suite blind to that. Mutating SCAN_ROOT to tests/ left all of them green.
 */
const SCOPE_PROBES: Probe[] = [
  {
    name: "SCOPE: violation outside tests/ -- the repo is the scan root",
    want: 1,
    expect: "_probe_scope_done_means",
    files: { "outside.test.ts": `import { mock, test } from "bun:test";\nmock.module("../src/daemon/pool.ts", () => ({}));\ntest("t", () => {});\n` },
  },
  {
    name: "SCOPE: helper outside tests/, imported from outside tests/",
    want: 1,
    expect: "h/helper.ts",
    files: {
      "h/helper.ts": `import { mock } from "bun:test";\nmock.module("../../src/daemon/transports.ts", () => ({}));\nexport const h = 1;\n`,
      "outside.test.ts": `import { test } from "bun:test";\nimport { h } from "./h/helper.ts";\ntest("t", () => { void h; });\n`,
    },
  },
  {
    name: "SCOPE: clean file outside tests/ -- still passes",
    want: 0,
    files: { "outside.test.ts": `import { test, expect } from "bun:test";\ntest("t", () => expect(1).toBe(1));\n` },
  },
];

const LINK_PROBES: LinkProbe[] = [
  {
    name: "symlink INSIDE the repo -- followed, poison caught",
    want: 1,
    build: () => {
      mkdirSync(`${DIR}/real`, { recursive: true });
      mkdirSync(`${DIR}/h`, { recursive: true });
      writeFileSync(`${DIR}/real/helper.ts`, POISON("../../../src/daemon/transports.ts"));
      symlinkSync(`${DIR}/real/helper.ts`, `${DIR}/h/helper.ts`);
      writeFileSync(`${DIR}/probe.test.ts`, `import { test } from "bun:test";\nimport { h } from "./h/helper.ts";\ntest("t", () => { void h; });\n`);
    },
  },
  {
    name: "symlink OUTSIDE the repo -- reported, never silent",
    want: 1,
    build: () => {
      mkdirSync(OUTSIDE, { recursive: true });
      mkdirSync(`${DIR}/h`, { recursive: true });
      writeFileSync(`${OUTSIDE}/helper.ts`, POISON(`${REPO_ROOT}/src/daemon/transports.ts`));
      symlinkSync(`${OUTSIDE}/helper.ts`, `${DIR}/h/helper.ts`);
      writeFileSync(`${DIR}/probe.test.ts`, `import { test } from "bun:test";\nimport { h } from "./h/helper.ts";\ntest("t", () => { void h; });\n`);
    },
  },
  {
    name: "symlink OUTSIDE the repo, CLEAN content -- still reported",
    want: 1,
    build: () => {
      mkdirSync(OUTSIDE, { recursive: true });
      mkdirSync(`${DIR}/h`, { recursive: true });
      writeFileSync(`${OUTSIDE}/helper.ts`, `export const h = 1;\n`);
      symlinkSync(`${OUTSIDE}/helper.ts`, `${DIR}/h/helper.ts`);
      writeFileSync(`${DIR}/probe.test.ts`, `import { test } from "bun:test";\nimport { h } from "./h/helper.ts";\ntest("t", () => { void h; });\n`);
    },
  },
];

/** Raised when the probes could not run at all. Exit 3, never 1. */
class ProbeHarnessError extends Error {}

function runCheck(): { code: number; out: string } {
  const r = spawnSync("bun", [CHECK], { cwd: REPO_ROOT, encoding: "utf8" });
  // A missing or unrunnable `bun` is "could not look", not "a probe failed".
  // Throwing the raw error exited 1, which reads as a real probe failure and
  // sends someone to debug a check that never ran.
  if (r.error) {
    throw new ProbeHarnessError(
      `could not run the check -- ${(r.error as Error).message}`,
    );
  }
  return { code: r.status ?? 3, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function cleanup(): void {
  rmSync(DIR, { recursive: true, force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
  rmSync(OUTSIDE_TESTS, { recursive: true, force: true });
}

/** One ordered inventory, including the agreement regression exactly once. */
const CASES = [
  ...PROBES.map((p) => ({ name: p.name, run: () => runFileProbe(p, DIR) })),
  ...LINK_PROBES.map((p) => ({
    name: p.name,
    run: () => { p.build(); return runCheck(); },
    want: p.want,
  })),
  ...SCOPE_PROBES.map((p) => ({ name: p.name, run: () => runFileProbe(p, OUTSIDE_TESTS) })),
  { name: "guard/check protected lists agree", run: () => ({
    code: checkGuardAgreement() ? 0 : 1, out: "", want: 0,
  }) },
];

function runFileProbe(p: Probe, root: string) {
  for (const [rel, content] of Object.entries(p.files)) {
    const path = resolve(root, rel);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return { ...runCheck(), want: p.want, expect: p.expect };
}

function selection(args: string[]) {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args, strict: true, allowPositionals: false, tokens: true,
      options: { shard: { type: "string" }, shards: { type: "string" }, list: { type: "boolean" } },
    });
  } catch (error) {
    throw new ProbeHarnessError(`invalid arguments -- ${error instanceof Error ? error.message : "parse failed"}`);
  }
  const names = parsed.tokens?.filter((t) => t.kind === "option").map((t) => t.name) ?? [];
  if (new Set(names).size !== names.length) throw new ProbeHarnessError("duplicate option");
  const { shard, shards } = parsed.values;
  if (shard === undefined && shards === undefined) return { cases: CASES, list: parsed.values.list };
  // Canonical positive integers only: no partial parse, empty shards or overflow.
  if (typeof shard !== "string" || typeof shards !== "string" ||
      !/^[1-9][0-9]*$/.test(shard) || !/^[1-9][0-9]*$/.test(shards) ||
      !Number.isSafeInteger(Number(shard)) || !Number.isSafeInteger(Number(shards)) ||
      Number(shard) > Number(shards) || Number(shards) > CASES.length) {
    throw new ProbeHarnessError(`use --shard N --shards M with 1 <= N <= M <= ${CASES.length}`);
  }
  return { cases: CASES.filter((_, i) => i % Number(shards) === Number(shard) - 1), list: parsed.values.list };
}

function main(): number {
  // Validate BEFORE cleanup: malformed input must not mutate the checkout.
  const selected = selection(process.argv.slice(2));
  if (selected.list) {
    console.log(JSON.stringify(selected.cases.map((p) => p.name)));
    return 0;
  }
  // A leftover probe directory would be scanned as real content and every
  // result after it would be meaningless.
  cleanup();

  // Someone ELSE's leftovers are the dangerous case, because cleanup() does
  // not touch them. Observed: a probe run killed mid-flight left its directory
  // behind, and the next run reported 45/69 with no hint that the tree was
  // contaminated rather than the check broken. A probe suite that silently
  // absorbs foreign state is worse than one that refuses to start.
  const scan = (dir: string, own: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((e) => e.startsWith("_probe") && join(dir, e) !== own)
          .map((e) => relative(REPO_ROOT, join(dir, e)))
      : [];
  const foreign = [...scan(TESTS, DIR), ...scan(REPO_ROOT, OUTSIDE_TESTS)];
  if (foreign.length > 0) {
    console.log("HARNESS: probe directories from another run are in the tree, so");
    console.log("the check would scan them and no result here would mean anything:");
    for (const f of foreign) console.log(`  ${f}`);
    console.log("Remove them and rerun.");
    return 3;
  }

  const baseline = runCheck();
  if (baseline.code !== 0) {
    console.log("HARNESS: the repo does not pass the check before probing, so");
    console.log("no probe result means anything. Fix the repo first:");
    console.log(baseline.out.trim());
    return 3;
  }

  let failed = 0;
  const report = (
    name: string,
    got: number,
    want: number,
    out: string,
    expect?: string,
  ) => {
    const codeOk = got === want;
    const textOk = expect === undefined || out.includes(expect);
    const ok = codeOk && textOk;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} exit=${got} want=${want}  ${name}`);
    if (!codeOk) {
      for (const line of out.trim().split("\n").slice(0, 4)) console.log(`     ${line}`);
    } else if (!textOk) {
      console.log(`     right exit, WRONG REASON -- output lacks: ${expect}`);
    }
  };

  try {
    for (const p of selected.cases) {
      cleanup();
      const r = p.run();
      const want = "want" in r ? r.want : "want" in p ? p.want : 0;
      report(p.name, r.code, want, r.out, "expect" in r ? r.expect : undefined);
    }
  } finally {
    cleanup();
  }

  const total = selected.cases.length;
  console.log(`\n${total - failed}/${total} probes behaved as specified`);
  return failed === 0 ? 0 : 1;
}

/**
 * Do the static check and the runtime guard protect the same set, and allow
 * the same one exception? Compared by reading both sources, so neither can be
 * edited alone. Exits the suite as a failed probe rather than a harness error:
 * the files are present and readable, the answer is just wrong.
 */
function checkGuardAgreement(): boolean {
  const GUARD = resolve(REPO_ROOT, "tests/guard-transport-mocks.ts");
  const CHECK = resolve(
    REPO_ROOT,
    "scripts/done-means/no-connection-module-mocks.ts",
  );
  const read = (p: string): string => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      throw new ProbeHarnessError(`cannot read ${relative(REPO_ROOT, p)}`);
    }
  };
  // Both lists name the same modules; the static check writes them with a
  // .ts extension and the guard without, since it strips extensions before
  // comparing. Normalise to the extensionless form on both sides.
  const strip = (s: string): string => s.replace(/\.[a-z]+$/i, "");
  const listOf = (text: string, name: string): string[] => {
    const m = text.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
    if (!m) return [];
    return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => strip(x[1]!)).sort();
  };
  const checkList = listOf(read(CHECK), "PROTECTED_PATHS");
  const guardList = listOf(read(GUARD), "PROTECTED");
  const same =
    checkList.length > 0 &&
    checkList.length === guardList.length &&
    checkList.every((v, i) => v === guardList[i]);
  if (!same) {
    console.log(
      `FAIL              guard/check protected lists agree\n` +
        `  check: ${checkList.join(", ") || "(none parsed)"}\n` +
        `  guard: ${guardList.join(", ") || "(none parsed)"}`,
    );
    return false;
  }
  // Neither side has an allowlist any more: the one exempt call was moved onto
  // a seam, so the rule is unconditional. Asserted rather than assumed, because
  // an exemption reappearing in ONE of the two is exactly the drift this probe
  // exists to catch -- a hole in the guard, or a false failure from the check.
  const checkAllowed = /const ALLOWED\s*=/.test(read(CHECK));
  const guardAllowed = /const ALLOWED\s*=/.test(read(GUARD));
  if (checkAllowed || guardAllowed) {
    console.log(
      `FAIL              guard/check agree on having no allowlist\n` +
        `  check declares ALLOWED: ${checkAllowed}\n` +
        `  guard declares ALLOWED: ${guardAllowed}\n` +
        `  An exemption must exist on BOTH sides or neither.`,
    );
    return false;
  }
  console.log(`ok   agreement    guard and check protect the same set`);
  return true;
}

try {
  process.exit(main());
} catch (err) {
  if (err instanceof ProbeHarnessError) {
    console.log(`HARNESS: ${err.message}`);
    process.exit(3);
  }
  throw err;
}
