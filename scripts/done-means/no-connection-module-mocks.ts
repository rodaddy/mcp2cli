/**
 * DONE-MEANS: no test patches the process-global module registry for the
 * transports. `mock.module()` replaces a module for the WHOLE bun process and
 * nothing puts it back -- measured during Forge issue #75, where capturing the
 * real modules and re-registering them in `afterAll` left the same 9 failures.
 * `mock.restore()` does not undo it either. A single new call silently
 * contaminates every test file that runs after it in CI's single-process run,
 * and the failure surfaces in an unrelated file, which is why #75 took a full
 * session to diagnose. The leak is FILE-ORDER dependent and the runner's order
 * is not alphabetical, so a developer reproducing locally can run the mocking
 * file after its victims and see green.
 *
 * PR #84 removed every such call and replaced it with seams a test can
 * restore. This check is what stops them coming back.
 *
 * The premise re-measured on bun 1.3.14, one `mock.module()` added to a single
 * test file and a full repo-wide `bun test` run: `src/connection/connect.ts`
 * broke 2 later tests, `src/daemon/pool.ts` broke 50, `src/daemon/transports.ts`
 * broke 7. Note what that spread means for reproducing a report -- the blast
 * radius is the victim set the patched module actually reaches, so an
 * innocuous-looking factory can read as harmless against one target and take
 * out fifty tests against another. `bun test <dir>` can also be green where a
 * repo-wide run is red. Neither result disproves the leak.
 *
 *   bun scripts/done-means/no-connection-module-mocks.ts
 *
 * Exit grammar: 0 pass, 1 fail, 3 harness error (repo root absent, unreadable
 * file, parse failure).
 *
 * WHY A PARSER AND NOT grep: the first version of this check was a regex over
 * source text, and a pre-merge audit walked straight through it four ways --
 * a single-quoted path, a backtick path, a path in a variable, and, worst, a
 * call split across lines, which is what any formatter produces once the
 * argument list exceeds the print width. That last one arrives by accident,
 * not by malice. The same audit showed the regex FAILING a build for a comment
 * that merely warned people not to call mock.module -- the perverse case where
 * the cheapest fix is deleting the warning. A gate with known bypasses and
 * known false positives is worse than none, because it is trusted. The
 * TypeScript AST sees a call the way bun does: quoting, whitespace, and line
 * breaks are all the same node, and a comment is not a node at all.
 *
 * KNOWN LIMIT, stated rather than hidden: reflective extraction of the
 * function -- `Reflect.get(mock, "module")`, and by extension
 * `Object.getOwnPropertyDescriptor(mock, "module").value` or a Proxy -- is NOT
 * caught. The general fix is to treat the namespace itself being handed to any
 * function as an escape, and it was tried and reverted: it flags
 * `const spy = mock(() => 1)`, ordinary spy use, and broke the repo's own
 * baseline. A gate that fails correct code is worse than one with a stated
 * hole, because the cheapest fix becomes deleting the gate. Forge issue #90
 * carries the runtime preload guard, which blocks this and every other
 * acquisition spelling by intercepting the call instead of reading the source
 * -- measured against all four bypasses this round found.
 *
 * BEFORE CHANGING ANYTHING HERE, run the probe suite beside this file:
 *
 *   bun scripts/done-means/no-connection-module-mocks.probe.ts
 *
 * Eight review rounds each found a real defect in this check. By round 8 EVERY
 * finding was a defect in a previous round's fix rather than in the original,
 * and two of the four rejected correct, passing code -- the direction this
 * check's own rule calls the worse failure. The 88 probes pin the boundaries those
 * rounds established, and each suppression is paired with a probe that adds a
 * real escape -- so a change that silences a false positive by disabling
 * detection fails there rather than in a later round.
 */
import { readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import ts from "typescript";

const REPO_ROOT = resolve(import.meta.dir, "../..");

/**
 * The check walks the REPO, not just tests/. CI runs a bare `bun test`, which
 * discovers test files anywhere -- a `mock.module()` in src/foo.test.ts poisons
 * the single-process run exactly like one under tests/, and scanning only
 * tests/ passed it while reporting a healthy file count. The walker's scope
 * and the runner's scope must be the same scope.
 */
const SCAN_ROOT = REPO_ROOT;

/**
 * Module specifiers a test must not replace in the global registry.
 *
 * `connection(\/|$)` and not `connection\/`: bun resolves a bare directory
 * specifier to its index, so mock.module("../../src/connection") replaces
 * src/connection/index.ts -- which re-exports connectToService, setConnector,
 * and resetConnector. That is the BROADEST possible patch of the seam, and the
 * narrower pattern let it through.
 */
const FORBIDDEN = [
  { match: /(^|\/)connection(\/|$)/, label: "src/connection/*" },
  // Any extension, not just .ts: bun resolves "daemon/pool.js" to the real
  // pool.ts and the patch lands, so pinning the extension was a bypass.
  { match: /(^|\/)daemon\/pool(\.[a-z]+)?$/, label: "src/daemon/pool.ts" },
  { match: /(^|\/)daemon\/transports(\.[a-z]+)?$/, label: "src/daemon/transports.ts" },
];

/**
 * The protected modules, as repo-relative paths. FORBIDDEN above matches
 * SPELLINGS, which is what an unresolvable specifier leaves to judge; this is
 * the anchored truth for a specifier that resolves to a real file, so a local
 * fixture at `tests/.../fake/daemon/pool.ts` is not mistaken for the module
 * it happens to share a suffix with. `src/connection` is a directory: any
 * file under it counts.
 */
const PROTECTED_PATHS = [
  "src/connection",
  "src/daemon/pool.ts",
  "src/daemon/transports.ts",
];

/**
 * Extensions bun's test runner executes. The walker MUST agree with this: a
 * file the runner runs and the walker skips is a violation that passes, and a
 * skipped file is indistinguishable from a clean one in the file count, so the
 * omission gives no signal. Verified by observing `bun test` discovery.
 */
const RUNNABLE = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];

/**
 * What a resolver appends to a specifier, in the order bun tries them: the
 * written path itself, then each extension, then a directory index. Used for
 * both an import specifier and a `package.json` "main" -- they are the same
 * kind of string, and resolving them by different rules is how a directory
 * import got followed to the wrong file.
 */
const SPECIFIER_SUFFIXES = [
  "",
  ...RUNNABLE,
  ...RUNNABLE.map((e) => `/index${e}`),
];

/**
 * The NAME pattern bun's runner requires, on top of the extension. Measured:
 * `*.test.*`, `*_test.*`, `*.spec.*`, `*_spec.*` run; `plain.ts`,
 * `fixture.mts`, and `helper.helper.ts` do not.
 *
 * This matters in both directions. Judging every runnable file flags a
 * `mock.module()` in a fixture bun never loads -- a blocked build over code
 * that cannot contaminate anything, which is the false-positive class this
 * check exists to avoid. Judging too few misses a real patch. The line is
 * exactly bun's own discovery, so the check reads what the runner runs.
 */
const TEST_NAME = /[._](test|spec)\./i;

// There is no allowlist. There was exactly one exempt call, in
// tests/cli/daemon-routed-discovery.test.ts, and #86 moved it onto the
// setDaemonSchemaClient() seam. The rule is unconditional now: no file bun
// loads may patch the registry for a protected module, with no exceptions to
// keep current. If one is ever needed again, add it back with its own clause
// -- an exemption nothing verifies is how a rule quietly stops being one.

/**
 * Directories neither we nor bun's runner judge: vendored code and build
 * output. Everything else under the repo root is walked, because `bun test`
 * would run a test file found there.
 */
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "coverage"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Vendored and generated code is not ours to judge, and parsing it would
      // make the file count depend on whether deps happen to be installed. A
      // dot-DIRECTORY is skipped because bun's test runner skips it too --
      // measured, so walker and runner agree.
      if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
      walk(full, out);
    } else if (
      // Lowercased: bun's discovery is case-INSENSITIVE, so `foo.Test.TS` runs
      // and a case-sensitive check reads right past it while the file count
      // stays healthy. Measured on bun 1.3.14.
      RUNNABLE.some((ext) => entry.toLowerCase().endsWith(ext)) &&
      TEST_NAME.test(entry)
    ) {
      // A dot-FILE is NOT skipped: `tests/.hidden.test.ts` runs under
      // `bun test` (measured). Skipping it here would hide a violation in a
      // file CI executes.
      out.push(full);
    }
  }
  return out;
}

interface Call {
  file: string;
  line: number;
  target: string;
  /** A non-literal argument: the specifier could not be read statically. */
  dynamic: boolean;
  /** How the call was spelled, for a message that names what was found. */
  via: string;
}

/**
 * A statically-readable module specifier: a string literal OR a
 * no-substitution template. ONE definition, used by both the call matcher and
 * the import-closure walker -- they were written separately, drifted, and a
 * backtick specifier in `await import(`./helper`)` hid an entire helper
 * subtree from the closure while the matcher would have caught it. The
 * difference between caught and missed was one quote character.
 */
function staticSpecifier(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  const n = unwrap(node);
  return ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
    ? n.text
    : undefined;
}

/** Strip parentheses and `as`/`satisfies` wrappers down to the real node. */
function unwrap(node: ts.Node): ts.Node {
  let n = node;
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isNonNullExpression(n)
  ) {
    n = n.expression;
  }
  return n;
}

/**
 * Sentinel for a property name that could not be read statically. A constant
 * and not a bare literal: the producer and the comparison must agree, and two
 * separately-written strings is precisely how that stops being true.
 */
const COMPUTED = "<computed>";

/** The property name of `x.module` or `x["module"]`, if that is what this is. */
function accessedName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) {
    const arg = unwrap(node.argumentExpression);
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
      return arg.text;
    }
    // A computed name this check cannot read. Reported by the caller as
    // unresolvable rather than assumed harmless.
    return COMPUTED;
  }
  return undefined;
}

/**
 * Every identifier a binding name introduces. A plain `mock` yields one name;
 * `{ mock }`, `{ a: mock }`, `[mock]`, and `{ ...mock }` each yield theirs.
 * Used for parameter shadowing, where reading only the simple form left the
 * destructured spelling unshadowed and it false-positived as a violation.
 */
function boundNames(name: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(name)) {
    out.push(name.text);
    return out;
  }
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) boundNames(el.name, out);
  }
  return out;
}

/**
 * If this node re-binds names, the names it binds and the source span over
 * which that binding — rather than an outer one of the same name — is what a
 * read resolves to. `undefined` when the node binds nothing.
 *
 * The span is deliberately the narrowest node the binding governs:
 *
 *  - a PARAMETER governs the function BODY, not the whole function. A
 *    parameter is not in scope for default-value expressions in its own
 *    parameter list, so `function evil(x = mock.module, mock?: any)` reads
 *    the REAL mock there; a whole-function span suppressed it and the check
 *    exited 0 with a live registry patch.
 *  - a CATCH variable governs its block.
 *  - a `let`/`const`/`for`-binding governs its enclosing block or statement.
 *    A `var` is function-scoped, so its enclosing function is used when there
 *    is one.
 *
 * Widening any of these would hide a real violation outside the binding's
 * reach, which is the failure mode this whole mechanism keeps producing.
 */
function shadowScope(
  node: ts.Node,
  source: ts.SourceFile,
): { names: string[]; start: number; end: number } | undefined {
  const span = (scope: ts.Node | undefined, name: ts.BindingName) => {
    if (!scope) return undefined;
    const names = boundNames(name);
    return names.length
      ? { names, start: scope.getStart(source), end: scope.getEnd() }
      : undefined;
  };

  if (ts.isParameter(node)) {
    return span((node.parent as ts.Node & { body?: ts.Node })?.body, node.name);
  }
  if (ts.isCatchClause(node) && node.variableDeclaration) {
    return span(node.block, node.variableDeclaration.name);
  }
  if (ts.isVariableDeclaration(node)) {
    // list -> declarations -> statement (or for-initializer). The statement's
    // parent is the block, function body, or source file it lives in; a
    // for-statement governs itself.
    const list = node.parent;
    const stmt = list?.parent;
    if (!stmt) return undefined;
    const isVar =
      ts.isVariableDeclarationList(list) &&
      (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
    const scope = ts.isVariableStatement(stmt)
      ? isVar
        ? enclosingFunctionBody(stmt) ?? stmt.parent
        : stmt.parent
      : stmt;
    return span(scope, node.name);
  }
  return undefined;
}

/** The body of the nearest enclosing function-like node, if any. */
function enclosingFunctionBody(node: ts.Node): ts.Node | undefined {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    const body = (n as ts.Node & { body?: ts.Node }).body;
    if (body && ts.isFunctionLike(n)) return body;
  }
  return undefined;
}

/**
 * The TypeScript source paths a NodeNext/ESM specifier can name. `./x.js`
 * means `x.ts` or `x.tsx`; `./x.mjs` means `x.mts`; `./x.cjs` means `x.cts`.
 * Empty for a specifier that names no emitted-JS extension.
 */
function jsToTsBases(path: string): string[] {
  const REWRITE: Record<string, string[]> = {
    ".js": [".ts", ".tsx"],
    ".jsx": [".tsx"],
    ".mjs": [".mts"],
    ".cjs": [".cts"],
  };
  for (const [from, tos] of Object.entries(REWRITE)) {
    if (path.endsWith(from)) {
      return tos.map((to) => path.slice(0, -from.length) + to);
    }
  }
  return [];
}

/**
 * Is this declaration a binding in a scope that does NOT contain the use
 * site? Such a declaration is a different variable and says nothing about
 * what the name holds at the use -- the shadow test judges it by span
 * instead, so counting it as a redeclaration only rejects correct code.
 */
function isNestedShadowOf(
  node: ts.VariableDeclaration,
  use: ts.Identifier,
  source: ts.SourceFile,
): boolean {
  const shadow = shadowScope(node, source);
  if (!shadow || !shadow.names.includes(use.text)) return false;
  const pos = use.getStart(source);
  return pos < shadow.start || pos >= shadow.end;
}

/**
 * The literal a dynamic import's variable argument holds, when the file
 * declares it exactly once as a `const` with a string literal initializer:
 * `const pkg = "node:path"; await import(pkg)`.
 *
 * Only that shape. A name assigned more than once, or initialized with
 * anything but a literal, stays unresolved and is reported -- the point is to
 * stop calling a DECIDABLE import unfollowable, not to guess at an
 * undecidable one. Reported bare specifiers were the complaint: a lazy
 * `import(pkg)` of a node builtin failed a check whose own doctrine says
 * non-relative modules are not its to judge.
 */
function constSpecifier(
  arg: ts.Node | undefined,
  source: ts.SourceFile,
): string | undefined {
  if (!arg) return undefined;
  const id = unwrap(arg);
  if (!ts.isIdentifier(id)) return undefined;

  let found: string | undefined;
  let count = 0;
  const scan = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === id.text &&
      // A catch binding is a VariableDeclaration whose parent is the
      // CatchClause, not a declaration list. Treating it as a redeclaration
      // of the same name made an unrelated `catch (pkg)` anywhere in the file
      // force the ambiguous path, so a correct `import(pkg)` failed a passing
      // build. It IS a shadow, and the shadow branch below judges it by span.
      !ts.isCatchClause(node.parent) &&
      // Likewise a declaration in a NESTED scope: `function f() { const pkg =
      // "node:os"; }` is a different variable from the outer `pkg`, and
      // counting it as a redeclaration rejected a decidable outer
      // `import(pkg)`. Only a declaration whose scope contains the import
      // site can change what the name holds there -- the shadow branch below
      // makes exactly that test.
      !isNestedShadowOf(node, id, source)
    ) {
      count++;
      const list = node.parent;
      const isConst =
        ts.isVariableDeclarationList(list) &&
        (list.flags & ts.NodeFlags.Const) !== 0;
      const init = node.initializer && staticSpecifier(node.initializer);
      if (isConst && init !== undefined) found = init;
      else count++; // non-const or non-literal: force the ambiguous path
    }
    // A PARAMETER or other binding of the same name is a different variable.
    // Counting only variable declarations meant
    // `const pkg = "node:path"; function load(pkg) { return import(pkg) }`
    // resolved the import to "node:path" and skipped it, while bun loaded
    // whatever the caller passed -- a poisoning helper, at exit 0. Any
    // re-binding of the name makes the value undecidable here.
    // Variable declarations are handled above; counting them here too would
    // make the ordinary single `const pkg = "..."` look re-bound.
    if (!ts.isVariableDeclaration(node) || ts.isCatchClause(node.parent)) {
      const shadow = shadowScope(node, source);
      // Only a shadow whose SCOPE CONTAINS the import site can change what
      // the name holds there. shadowScope already returns that span and this
      // discarded it, so an unrelated `catch (pkg)` or `function f(pkg)`
      // elsewhere in the file made a correct `import(pkg)` undecidable and
      // failed a passing build -- the false-positive class this check calls
      // the worse defect. isShadowedAt does this correctly; this is the same
      // test, applied at the same span.
      const site = id.getStart(source);
      if (
        shadow &&
        shadow.names.includes(id.text) &&
        site >= shadow.start &&
        site < shadow.end
      ) {
        count += 2;
      }
    }
    // Any reassignment makes the value undecidable.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(unwrap(node.left)) &&
      (unwrap(node.left) as ts.Identifier).text === id.text
    ) {
      count += 2;
    }
    ts.forEachChild(node, scan);
  };
  scan(source);
  return count === 1 ? found : undefined;
}

/**
 * The file a directory's `package.json` "main" names, when the directory has
 * one and the target exists. Node and bun consult this BEFORE `index.*`, so a
 * directory import can load a file no extension-appending resolver reaches.
 */
function packageMain(dir: string): string | undefined {
  if (!ts.sys.directoryExists(dir)) return undefined;
  const manifest = join(dir, "package.json");
  const text = ts.sys.readFile(manifest);
  if (text === undefined) return undefined;
  let main: unknown;
  try {
    main = (JSON.parse(text) as { main?: unknown }).main;
  } catch {
    // An unparseable package.json is the runner's problem, not a resolution
    // this check can make. The caller reports the import as unresolved.
    return undefined;
  }
  if (typeof main !== "string" || main.length === 0) return undefined;
  // "main" is a SPECIFIER, not a path: Node and bun append extensions and try
  // `<main>/index.*` exactly as they do for an import. Resolving it by exact
  // path only meant `"main": "poison"` returned undefined, the caller fell
  // through to its own `<dir>/index.*` candidate, that SUCCEEDED against a
  // decoy index file, and the import was recorded as followed. Worse than an
  // unresolved import: the check reported imports-all-followed while reading
  // a file the runner never loads. Measured at exit 0 with the pool registry
  // replaced (`Object.keys` = the fake's).
  return resolveAs(resolve(dir, main));
}

/**
 * The file a specifier already resolved to an absolute base names on disk,
 * applying bun's own extension and directory-index expansion. Shared by
 * import resolution and `package.json` "main" so the two cannot drift.
 */
function resolveAs(base: string): string | undefined {
  const candidates = [base, ...jsToTsBases(base)].flatMap((b) =>
    SPECIFIER_SUFFIXES.map((suffix) => b + suffix),
  );
  return candidates.find((candidate) => ts.sys.fileExists(candidate));
}

/**
 * Does this import/export actually load the module at runtime? A type-only
 * import is erased by the compiler, so bun never reads that file.
 *
 * Two spellings: `import type { T } from "./x"` sets isTypeOnly on the clause,
 * and `import { type T, type U } from "./x"` sets it per specifier -- the
 * latter is a runtime import only if at least one binding is not type-only.
 * A side-effect import (`import "./x"`) has no clause at all and always loads.
 */
function isRuntimeImport(
  node: ts.ImportDeclaration | ts.ExportDeclaration,
): boolean {
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return false;
    // An export has the same per-specifier spelling an import does:
    // `export { type H } from "./x"` is erased exactly like
    // `import { type H } from "./x"`. Checking only the declaration-level
    // flag followed an edge bun never takes, and failed a passing build.
    // `export * from "./x"` has no clause and always loads.
    const clause = node.exportClause;
    if (clause && ts.isNamedExports(clause)) {
      return (
        clause.elements.length === 0 ||
        clause.elements.some((el) => !el.isTypeOnly)
      );
    }
    return true;
  }
  const clause = node.importClause;
  if (!clause) return true; // import "./x" -- side effect, always loads
  if (clause.isTypeOnly) return false;
  const named = clause.namedBindings;
  if (named && ts.isNamedImports(named) && !clause.name) {
    // Every binding type-only means nothing remains at runtime. An empty list
    // (`import {} from "./x"`) still loads the module.
    return (
      named.elements.length === 0 || named.elements.some((el) => !el.isTypeOnly)
    );
  }
  return true;
}

/** A condition under which the check could not look. Exit 3, never 0 or 1. */
class HarnessError extends Error {}

/** Every `mock.module(...)` call in a file, with its specifier when literal. */
function findMockModuleCalls(file: string): Call[] {
  // ts.sys.readFile returns undefined for EVERY failure -- missing, EACCES,
  // EISDIR -- with no way to tell them apart. Defaulting to "" would parse an
  // empty file, find no calls, and report the file clean, so a file the check
  // CANNOT READ would pass. Unreadable is a harness error, never a pass.
  const text = ts.sys.readFile(file);
  if (text === undefined) {
    throw new HarnessError(`could not read ${relative(REPO_ROOT, file)}`);
  }
  // The script kind must match the extension or the parser reports spurious
  // damage: JSX in a file parsed as plain TS is a syntax error, and the
  // diagnostics check below would turn that into a harness failure.
  const kind = file.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : file.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : /\.(js|mjs|cjs)$/.test(file)
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );

  // createSourceFile does NOT throw on malformed input -- it recovers and
  // records the damage in parseDiagnostics. A file it could not parse yields
  // no call nodes, which is indistinguishable from a clean file, so silence
  // here would mean "unparseable" reported as PASS.
  //
  // Exception: a fixtures directory is where a repo keeps DELIBERATELY broken
  // input (this one already has invalid-not-json.txt and six invalid-*.json).
  // The natural next one as .ts would exit 3 and block CI with no workaround,
  // so an unparseable file there is skipped rather than fatal. Fixtures are
  // data, not code bun executes as a test.
  //
  // But the hatch is only as true as its own justification. A file under
  // fixtures/ whose NAME matches bun's test pattern IS code bun executes as a
  // test, so `fixtures/poison.test.ts` -- unparseable, and therefore yielding
  // no nodes -- passed at exit 0 while the runner loaded and ran it. The
  // exception is for data; a discovered test file is never data.
  const rel = relative(REPO_ROOT, file);
  const isFixture = /(^|\/)fixtures\//.test(rel) && !TEST_NAME.test(basename(rel));
  const diags = (source as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] })
    .parseDiagnostics;
  if (diags && diags.length > 0) {
    if (!isFixture) {
      const first = ts.flattenDiagnosticMessageText(diags[0]!.messageText, " ");
      throw new HarnessError(
        `could not parse ${relative(REPO_ROOT, file)} -- ${first}`,
      );
    }
    // An unparseable fixture yields no reliable nodes, so stop here rather
    // than walking a damaged tree and reporting whatever survived recovery.
    return [];
  }
  const calls: Call[] = [];

  // Names in this file that reach bun's module registry. Seeded with `mock`
  // and grown as the file aliases it. An earlier version matched ONLY the
  // literal spelling `mock.module(...)`, so `mock["module"]`, a destructured
  // `{ module: patch }`, an aliased `const m = mock`, and a captured
  // `const patch = mock.module` all patched the registry unseen -- each proven
  // to poison a later file exactly as the caught spelling does.
  //
  // Seeded ONLY from a real `bun:test` import, never with a bare "mock". A
  // local helper object that happens to be named `mock` is not bun's, and
  // failing a build over one is the same false-positive class the AST rewrite
  // existed to remove -- there, the cheapest fix would be renaming a correct
  // variable.
  //
  // `mock` itself is the namespace; `patch` is the bound function.
  const namespaceNames = new Set<string>();
  const functionNames = new Set<string>();
  /** `import * as bt from "bun:test"` -- bt.mock is the namespace. */
  const starImports = new Set<string>();
  /**
   * Names bound to the module FETCHER itself: `const req = require`. A call
   * through one of these loads a module exactly as `require` does, which is
   * how `req("bun:test")` reaches the namespace.
   *
   * Tracked by BINDING rather than by callee spelling. Accepting any call
   * whose sole argument is "bun:test" covered the aliases, but it also
   * treated an ordinary function that happens to take that string --
   * `register("bun:test")` -- as bun's namespace, and failed a passing build
   * on code with no mock in it.
   */
  const fetcherNames = new Set<string>(["require"]);
  /**
   * Names that held the mock namespace and were later reassigned, or that a
   * narrower scope redeclares as something unrelated. Which value reaches a
   * given call is not decidable here, so these are reported as ambiguous
   * rather than asserted to be registry patches.
   */
  const rebound = new Set<string>();
  /**
   * Names bound to an object LITERAL that carries the mock namespace as a
   * property: `const o = { mock }`, so `o.mock.module(...)` still reaches the
   * registry.
   */
  const wrapperNames = new Set<string>();
  /**
   * Function PARAMETERS that shadow a tracked name, each with the source span
   * of the function that owns it. A parameter is a fresh binding, so `mock`
   * there is not bun's mock, and the escape backstop must not read its
   * `.module` as an escaped reference.
   *
   * The SPAN is the point. Suppressing by name alone let a single decoy
   * parameter -- `function decoy(mock: { module: string })` -- turn off the
   * backstop for that name across the WHOLE file, so a real escaped reference
   * elsewhere in it went unreported and the check exited 0. A suppression
   * that hides a violation is worse than the false positive it was added to
   * fix, so it now applies only INSIDE the shadowing function.
   */
  const shadowedByParam: { name: string; start: number; end: number }[] = [];
  /** Is this read lexically inside a function whose parameter shadows `name`? */
  const isShadowedAt = (name: string, pos: number): boolean => {
    return shadowedByParam.some(
      (s) => s.name === name && pos >= s.start && pos < s.end,
    );
  };

  /** Does this expression evaluate to the `mock` namespace? */
  const isNamespace = (node: ts.Node): boolean => {
    const n = unwrap(node);
    if (ts.isIdentifier(n)) return namespaceNames.has(n.text);
    // bt.mock, or require("bun:test").mock. Anything else named .mock is some
    // other object and is not ours to judge.
    if (accessedName(n) === "mock") {
      const owner = unwrap(
        (n as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression,
      );
      // `const o = { mock }; o.mock.module(...)` -- the wrapper is a plain
      // object, but the property still holds bun's mock.
      return isBunTestNamespace(owner) || wrapperNames.has(
        ts.isIdentifier(owner) ? owner.text : "",
      );
    }
    return false;
  };

  // Pass 1: seed from imports, so a `const m = mock` appearing ABOVE the
  // import statement is still recognised.
  const seedImports = (node: ts.Node): void => {
    // `import bt = require("bun:test")` is TypeScript's import-equals form. It
    // is neither an ImportDeclaration nor a VariableDeclaration, so both the
    // seeding pass and the alias pass walked straight past it and the whole
    // namespace arrived unseen.
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      staticSpecifier(node.moduleReference.expression) === "bun:test"
    ) {
      starImports.add(node.name.text);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.moduleSpecifier.text === "bun:test") {
        const clause = node.importClause;
        const named = clause?.namedBindings;
        if (named && ts.isNamedImports(named)) {
          for (const spec of named.elements) {
            if ((spec.propertyName ?? spec.name).text === "mock") {
              namespaceNames.add(spec.name.text);
            }
          }
        }
        // import * as bt from "bun:test" -- bt.mock.module(...)
        if (named && ts.isNamespaceImport(named)) {
          starImports.add(named.name.text);
        }
      }
    }
    ts.forEachChild(node, seedImports);
  };
  seedImports(source);

  /**
   * Learn aliases. Repeated to a fixed point rather than in one pass, so an
   * alias chain declared out of source order (`const b = a` above
   * `const a = mock`) resolves the same as one declared in order.
   */
  const learn = (node: ts.Node): void => {
    // A name RE-BOUND by a declaration is a different variable that shares a
    // name -- `function render(mock: { module: string })` is not bun's mock,
    // and flagging its `.module` blocked correct code whose cheapest fix was
    // renaming a correct binding.
    //
    // This judges the shared property, not a list of the places it can
    // happen. The parameter-only version was wrong four times in a row, each
    // time in a spelling nobody had listed: the suppression was file-scoped
    // by name (one decoy disabled the backstop everywhere); then its span was
    // the whole function, which wrongly covered the parameter list where the
    // OUTER binding is still live; then it read only simple identifiers, so
    // `function render({ mock })` shadowed nothing and false-positived; then
    // `catch (mock)`, `for (const mock of ...)`, and a block-local
    // `const mock` did the same. Every one is the same defect -- a binding the
    // check did not know about -- so the rule is now the binding itself.
    //
    // Two things make it a suppression rather than a hole. The SCOPE is the
    // narrowest node the binding actually governs, so a read outside it is
    // still judged; and shadowing only ever silences the escape BACKSTOP --
    // a real call still routes through visit() and clause 1.
    //
    // One exception, at the point of RECORDING rather than of reading: a
    // declaration whose initializer resolves to the mock is an ALIAS, not a
    // shadow. `const patch = mock.module` binds a name, but it binds it TO
    // the thing being tracked, so recording it as a shadow silences the alias
    // the learn pass just traced and lets `Reflect.apply(patch, ...)` past
    // the backstop. Suppressing by name at read time instead was measured
    // wrong in the other direction -- it reinstated every parameter false
    // positive in a file that also imports the real `mock`.
    const isAliasBinding =
      ts.isVariableDeclaration(node) &&
      !!node.initializer &&
      (isNamespace(node.initializer) ||
        isModuleFn(node.initializer) ||
        isBunTestNamespace(unwrap(node.initializer)));
    const shadow = isAliasBinding ? undefined : shadowScope(node, source);
    if (shadow) {
      for (const name of shadow.names) {
        shadowedByParam.push({ name, start: shadow.start, end: shadow.end });
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      bind(node.name, unwrap(node.initializer));
    }
    // `patch = mock.module` as a plain assignment, not a declaration.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      bind(unwrap(node.left), unwrap(node.right));
    }
    ts.forEachChild(node, learn);
  };

  /** Record what a binding target receives, for both = and destructuring. */
  function bind(target: ts.Node, init: ts.Node): void {
    // const o = { mock }  /  const o = { mock: mock }  -- an object literal
    // carrying the namespace as a property.
    if (ts.isIdentifier(target) && ts.isObjectLiteralExpression(init)) {
      for (const prop of init.properties) {
        const key = prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
          ? prop.name.text
          : undefined;
        if (key !== "mock") continue;
        const value = ts.isPropertyAssignment(prop)
          ? unwrap(prop.initializer)
          : ts.isShorthandPropertyAssignment(prop)
            ? prop.name
            : undefined;
        if (value && isNamespace(value)) wrapperNames.add(target.text);
      }
    }

    // const req = require -- the FETCHER itself bound to a new name, so a
    // later req("bun:test") loads the module exactly as require would.
    // Learned before the namespace test below, which consults this set.
    if (
      ts.isIdentifier(target) &&
      ts.isIdentifier(init) &&
      fetcherNames.has(init.text)
    ) {
      fetcherNames.add(target.text);
    }

    // const bt = require("bun:test")  /  const bt = await import("bun:test")
    // -- the MODULE object bound to a name, so bt.mock.module(...) resolves.
    // Only the inline and destructured forms were recognised before.
    if (ts.isIdentifier(target) && isBunTestNamespace(init)) {
      starImports.add(target.text);
    }

    // x = mock  /  x = bt.mock
    if (ts.isIdentifier(target) && isNamespace(init)) {
      namespaceNames.add(target.text);
    } else if (ts.isIdentifier(target) && namespaceNames.has(target.text)) {
      // The name held the mock namespace and now holds something else, or is
      // shadowed by an unrelated local. Which value reaches a later call is
      // not decidable from the AST, so the name is recorded as AMBIGUOUS and
      // reported as such -- calling it a registry patch would tell a developer
      // to replace a seam that was never there.
      rebound.add(target.text);
    }

    // x = mock.module  /  mock["module"]
    if (ts.isIdentifier(target) && isModuleFn(init)) {
      functionNames.add(target.text);
    }

    // const { module: patch } = mock, including the nested
    // const { mock: { module: patch } } = bt form.
    if (ts.isObjectBindingPattern(target)) {
      for (const el of target.elements) {
        const prop = el.propertyName ?? el.name;
        const key =
          ts.isIdentifier(prop) || ts.isStringLiteral(prop) ? prop.text : undefined;
        if (key === undefined) continue;
        // `{ mock }` or `{ mock: <pattern> }` destructured off the bun:test
        // namespace object -- from `import * as bt` or `require("bun:test")`.
        // A WRAPPER holds the namespace under `.mock` exactly as the bun:test
        // module object does -- `const w = { mock }` then `const { mock: m } = w`
        // extracts it. Gating on isBunTestNamespace() alone recognised
        // `w.mock.module(...)` but not the destructured extraction, so the
        // same object was seen through one spelling and not the other.
        const holdsMock =
          isBunTestNamespace(init) ||
          (ts.isIdentifier(init) && wrapperNames.has(init.text));
        if (key === "mock" && holdsMock) {
          if (ts.isIdentifier(el.name)) namespaceNames.add(el.name.text);
          else if (ts.isObjectBindingPattern(el.name)) bindModuleFrom(el.name);
        } else if (key === "module" && isNamespace(init)) {
          if (ts.isIdentifier(el.name)) functionNames.add(el.name.text);
        }
      }
    }
  }

  /** `{ module: patch }` nested inside a `{ mock: ... }` destructure. */
  function bindModuleFrom(pattern: ts.ObjectBindingPattern): void {
    for (const el of pattern.elements) {
      const prop = el.propertyName ?? el.name;
      const key =
        ts.isIdentifier(prop) || ts.isStringLiteral(prop) ? prop.text : undefined;
      if (key === "module" && ts.isIdentifier(el.name)) {
        functionNames.add(el.name.text);
      }
    }
  }

  /**
   * The bun:test MODULE object, as opposed to its `mock` member: the thing
   * `import * as bt from "bun:test"`, `require("bun:test")`, and
   * `await import("bun:test")` all evaluate to.
   */
  function isBunTestNamespace(node: ts.Node): boolean {
    const n = unwrap(node);
    if (ts.isIdentifier(n)) return starImports.has(n.text);
    // require("bun:test")  /  await import("bun:test")
    const call = ts.isAwaitExpression(n) ? unwrap(n.expression) : n;
    if (!ts.isCallExpression(call)) return false;
    const arg = call.arguments[0];
    const spec =
      arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))
        ? arg.text
        : undefined;
    if (spec !== "bun:test") return false;
    // The callee must be a module FETCHER: `import(...)`, `require(...)`, or
    // a name bound to require. Asking whether it is literally spelled
    // `require` was an enumeration that `const req = require` walked through;
    // accepting ANY callee was the overcorrection, and it read
    // `register("bun:test")` -- an ordinary function, no mock in the file --
    // as bun's namespace. Judge what the callee IS bound to.
    if (call.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    const callee = unwrap(call.expression);
    return ts.isIdentifier(callee) && fetcherNames.has(callee.text);
  }

  /**
   * `patch.call(...)`, `patch.apply(...)`, or `mock.module.bind(...)` -- the
   * function is reached through Function.prototype, so argument 0 is the
   * `this` value rather than the specifier. Unjudgeable, so fail closed.
   * Reflect.apply(patch, ...) is caught by the escape backstop instead, since
   * it passes the function as a value.
   */
  function isIndirectInvoke(callee: ts.Node): boolean {
    const name = accessedName(callee);
    if (name !== "call" && name !== "apply" && name !== "bind") return false;
    const owner = (callee as ts.PropertyAccessExpression | ts.ElementAccessExpression)
      .expression;
    return owner !== undefined && isModuleFn(owner);
  }

  /** Does this expression evaluate to the `mock.module` function itself? */
  function isModuleFn(node: ts.Node): boolean {
    const n = unwrap(node);
    if (ts.isIdentifier(n)) return functionNames.has(n.text);
    if (accessedName(n) !== "module") return false;
    const owner = (n as ts.PropertyAccessExpression | ts.ElementAccessExpression)
      .expression;
    return isNamespace(owner);
  }

  // Run to a fixed point: each pass can learn a name that makes the next pass
  // resolve one more, and declaration order in the file stops mattering.
  // The budget is generous, but hitting it means the analysis did NOT reach a
  // fixed point -- some alias chain is still unresolved. Reporting PASS there
  // is a check that gave up and called it clean, which is exactly what exit 3
  // exists to prevent. Measured: a reverse-order chain learns one link per
  // pass, so depth is what consumes the budget.
  const MAX_PASSES = 64;
  let settled = false;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // EVERY set a pass can grow counts toward the fixed point. Summing only
    // namespaces and functions meant a pass that learned a fetcher alias
    // (`const outer = inner; const inner = require`) left the sum unchanged
    // and the loop declared itself settled one pass early -- so the namespace
    // that alias would have yielded was never learned, and the check passed a
    // file that patches the registry.
    const before =
      namespaceNames.size +
      functionNames.size +
      fetcherNames.size +
      starImports.size +
      wrapperNames.size;
    learn(source);
    const after =
      namespaceNames.size +
      functionNames.size +
      fetcherNames.size +
      starImports.size +
      wrapperNames.size;
    if (after === before) {
      settled = true;
      break;
    }
  }
  if (!settled) {
    throw new HarnessError(
      `alias analysis did not settle within ${MAX_PASSES} passes in ` +
        `${relative(REPO_ROOT, file)} -- the file cannot be judged`,
    );
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      let via: string | undefined;
      let unresolvable = false;

      if (ts.isIdentifier(callee) && functionNames.has(callee.text)) {
        // A bound reference: const patch = mock.module; patch(...)
        via = `${callee.text}() [alias of mock.module]`;
      } else if (isIndirectInvoke(callee)) {
        // patch.call(...) / patch.apply(...) -- the specifier is no longer
        // argument 0, so the target cannot be read from its usual position.
        via = `${callee.getText(source)} [indirect invoke of mock.module]`;
        unresolvable = true;
      } else {
        const name = accessedName(callee);
        const owner = (callee as ts.PropertyAccessExpression | ts.ElementAccessExpression)
          .expression;
        const ownerName =
          owner && ts.isIdentifier(unwrap(owner))
            ? (unwrap(owner) as ts.Identifier).text
            : undefined;
        if (name !== undefined && owner && isNamespace(owner)) {
          if (name === "module" && ownerName && rebound.has(ownerName)) {
            // `${ownerName}` held the namespace at some point and something
            // else at another. Report the ambiguity, not a verdict.
            via = `${callee.getText(source)} (\`${ownerName}\` is reassigned or shadowed, so this call cannot be resolved)`;
            unresolvable = true;
          } else if (name === "module") {
            via = callee.getText(source);
          } else if (name === COMPUTED) {
            // mock[someVariable](...) -- the property cannot be read, so this
            // MIGHT be .module. Judged, not assumed harmless.
            via = callee.getText(source);
            unresolvable = true;
          }
        }
      }

      if (via !== undefined) {
        const arg = node.arguments[0];
        const line =
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const literal = staticSpecifier(arg);
        calls.push({
          file: relative(REPO_ROOT, file),
          line,
          target: literal ?? "<non-literal>",
          dynamic: unresolvable || literal === undefined,
          via,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);

  /**
   * Backstop. Everything above resolves specific BINDING FORMS, and that is a
   * game the check loses: a review round found five more ways to move the same
   * function into a callable position (require(), await import(), nested
   * destructuring, plain assignment, an object-literal property), and there is
   * no reason to believe that list is complete either.
   *
   * So instead of enumerating, detect the precondition they all share. Reading
   * `mock.module` as a VALUE rather than calling it puts the function somewhere
   * this check cannot follow. If that happens and the read is not one already
   * accounted for above, the file is unjudgeable -- reported, not assumed
   * harmless. Failing closed on what it cannot resolve is the property that
   * makes this a gate.
   */
  const escapes: number[] = [];
  /** A literal `<bun-test-mock>.module` property read, not an alias's use. */
  const isModuleRead = (node: ts.Node): boolean => {
    // A RESOLVED alias used as a value escapes just as thoroughly as the
    // property read does: `Reflect.apply(patch, ...)` never mentions
    // `.module`, so restricting this to property reads left a hole.
    if (ts.isIdentifier(node)) {
      return (
        functionNames.has(node.text) &&
        !isShadowedAt(node.text, node.getStart(source))
      );
    }
    const name = accessedName(node);
    // An UNREADABLE property name off the namespace is a read of something
    // this check cannot identify, and `mock["mod" + "ule"]` is exactly that.
    // Answering "not .module" whenever the name could not be read made the
    // backstop fail OPEN on the one input it exists for -- the sentinel was
    // produced and nothing consumed it. Any unreadable property of the mock
    // namespace counts as an escape.
    if (name === COMPUTED) {
      const owner = unwrap(
        (node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression,
      );
      // Shadowing applies here as everywhere else: `function f(...mock: T[])`
      // then `mock[0].module` is an unreadable index on a PARAMETER, not on
      // bun's namespace, and flagging it blocked correct code.
      const shadowed =
        ts.isIdentifier(owner) && isShadowedAt(owner.text, owner.getStart(source));
      if (!shadowed && isNamespace(owner)) return true;
    }
    if (name !== "module") return false;
    // `mock` here may be a parameter, not the import -- but only within the
    // function that declares that parameter. The backstop is a heuristic over
    // reads, so it defers where a real binder would disagree; a genuine call
    // still goes through visit() and clause 1.
    const ownerId = (node as ts.PropertyAccessExpression | ts.ElementAccessExpression)
      .expression;
    if (ownerId) {
      const id = unwrap(ownerId);
      if (
        ts.isIdentifier(id) &&
        isShadowedAt(id.text, id.getStart(source))
      ) {
        return false;
      }
    }
    const owner = (node as ts.PropertyAccessExpression | ts.ElementAccessExpression)
      .expression;
    return isNamespace(owner);
  };
  const findEscapes = (node: ts.Node): void => {
    if (isModuleRead(node)) {
      const parent = node.parent as ts.Node | undefined;
      // Being CALLED is fine -- visit() judged it. Being bound to a name the
      // learn pass already resolved is fine too. Anything else is an escape.
      const isCallee =
        parent && ts.isCallExpression(parent) && unwrap(parent.expression) === node;
      const isLearnedBinding =
        parent &&
        ((ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) &&
          functionNames.has(parent.name.text)) ||
          (ts.isBinaryExpression(parent) &&
            parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(unwrap(parent.left)) &&
            functionNames.has((unwrap(parent.left) as ts.Identifier).text)));
      if (!isCallee && !isLearnedBinding) {
        escapes.push(
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        );
      }
    }
    ts.forEachChild(node, findEscapes);
  };
  findEscapes(source);

  for (const line of escapes) {
    calls.push({
      file: relative(REPO_ROOT, file),
      line,
      target: "<escaped reference>",
      dynamic: true,
      via: "mock.module used as a value, so its call sites cannot be traced",
    });
  }

  return calls;
}

/**
 * Does this specifier, written in this file, actually name a protected
 * module? A RELATIVE specifier is judged by where it RESOLVES: matching the
 * suffix alone rejected `./fake/daemon/pool.ts`, a local fixture that patches
 * nothing real, while `bun test` passed on it. When the specifier resolves to
 * a file inside the repo, that resolved path is the honest thing to judge;
 * when it resolves to nothing, the written text is all there is, and the
 * suffix test still applies so an unresolvable spelling cannot slip through.
 */
function isForbiddenFrom(target: string, file: string): string | undefined {
  if (target.startsWith(".")) {
    const resolved = resolveAs(resolve(file, "..", target));
    if (resolved && resolved.startsWith(REPO_ROOT + "/")) {
      // It resolves to a real file in the repo, so the question is settled:
      // is THAT file protected? A suffix test on the resolved path is still
      // a suffix test -- `tests/.../fake/daemon/pool.ts` ends the same way
      // the real one does -- so the resolved path is matched against the
      // protected paths themselves, anchored at the repo root.
      const rel = relative(REPO_ROOT, resolved);
      return PROTECTED_PATHS.find((p) => rel === p || rel.startsWith(p + "/"))
        ? isForbidden(rel)
        : undefined;
    }
  }
  return isForbidden(target);
}

function isForbidden(target: string): string | undefined {
  // Percent-decode first: bun resolves "connect%2Ets" to "connect.ts", and
  // comparing the raw text let that spelling through while genuinely
  // replacing the module. Malformed escapes are left as written.
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    // not a valid escape sequence -- judge the literal text
  }
  // "pool.ts#frag" resolves to pool.ts and the patch lands, so a suffix must
  // not hide the target. Lowercased because bun's resolution reached
  // "POOL.ts" as pool.ts on a case-insensitive filesystem, and being strict
  // here costs nothing.
  decoded = decoded.replace(/[?#].*$/, "").toLowerCase();
  // Collapse interior dot segments BEFORE stripping the leading ones:
  // "daemon/not-a-dir/../pool.ts" is daemon/pool.ts to bun's resolver, and
  // comparing the written text let that spelling through.
  const segments: string[] = [];
  for (const seg of decoded.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      // A leading ".." is depth, not a segment to cancel; only pop a real one.
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else {
        segments.push("..");
      }
      continue;
    }
    segments.push(seg);
  }
  // Then drop leading ../ and the src/ prefix, so depth and alias spellings
  // collapse to the same thing.
  const normalized = segments
    .join("/")
    .replace(/^(\.\.\/)+/, "")
    .replace(/^src\//, "");
  return FORBIDDEN.find((f) => f.match.test(`/${normalized}`))?.label;
}

/**
 * Expand a set of test entrypoints to include the local modules they import,
 * transitively. Only RELATIVE specifiers are followed: a bare specifier is a
 * dependency, which is not ours to judge, and node_modules is skipped
 * everywhere else for the same reason.
 *
 * Resolution mirrors what bun accepts for a relative import: the written path,
 * then the TS/JS extensions, then an index file for a directory. A specifier
 * that resolves to nothing is simply not added -- it is not a file that can
 * contain a violation.
 */
function withLocalImports(
  entrypoints: string[],
): { files: string[]; unresolvedImports: string[] } {
  const seen = new Set(entrypoints);
  const queue = [...entrypoints];
  const unresolvedImports: string[] = [];
  const CANDIDATES = SPECIFIER_SUFFIXES;

  while (queue.length > 0) {
    const file = queue.pop()!;
    const text = ts.sys.readFile(file);
    if (text === undefined) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    const specifiers: string[] = [];
    // Names bound to the module fetcher in THIS file: `const req = require`.
    // A call through one loads the target exactly as require does, so it is a
    // closure edge. Testing the callee's spelling missed it -- the helper was
    // never followed and its mock.module() never read, at exit 0 with the pool
    // registry replaced. Seeded per file because the closure walker has no
    // cross-file binding analysis.
    const fetchers = new Set<string>(["require"]);
    // A local binding of a fetcher name is a DIFFERENT variable, but only
    // inside its own scope. Dropping the name file-wide let one decoy
    // (`function scope() { const require = (id) => ({id}); }`) turn off the
    // real `require(...)` edge for the whole file -- a suppression that hides
    // a violation, which is worse than the false positive it fixed. Each
    // shadow is recorded with its SPAN and consulted at the call site.
    const fetcherShadows: { name: string; start: number; end: number }[] = [];
    const seedFetchers = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        fetchers.has(node.initializer.text)
      ) {
        fetchers.add(node.name.text);
      }
      // A declaration bound TO a fetcher is what CREATES the alias, not a
      // shadow of it -- and at module scope its span is the whole file, so
      // recording it suppressed the very call it was meant to enable. Same
      // shape as the alias-binding exception on the namespace side.
      const bindsFetcher =
        ts.isVariableDeclaration(node) &&
        !!node.initializer &&
        ts.isIdentifier(node.initializer) &&
        fetchers.has(node.initializer.text);
      const shadow = bindsFetcher ? undefined : shadowScope(node, source);
      if (shadow) {
        for (const name of shadow.names) {
          fetcherShadows.push({ name, start: shadow.start, end: shadow.end });
        }
      }
      ts.forEachChild(node, seedFetchers);
    };
    const fetcherShadowedAt = (name: string, pos: number): boolean =>
      fetcherShadows.some(
        (s) => s.name === name && pos >= s.start && pos < s.end,
      );
    // To a FIXED POINT: `const a = b; const b = require` binds a to the
    // fetcher too, and a single pass in source order would not see it. Bounded
    // by the number of declarations, so it terminates.
    for (let size = -1; size !== fetchers.size; ) {
      size = fetchers.size;
      seedFetchers(source);
    }
    // Shadows are recomputed once the set has SETTLED. An early pass does not
    // yet know `inner` is a fetcher, so it files `const outer = inner` as a
    // shadow -- and that record outlives the pass that proves it an alias.
    fetcherShadows.length = 0;
    seedFetchers(source);

    const collect = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        // A TYPE-ONLY import is erased before the runtime ever sees it, so bun
        // never loads that file and its mock.module() never runs. Following it
        // failed a build over code that cannot contaminate anything -- the
        // false-positive class this check exists to avoid. Covers both
        // `import type { T } from "./x"` and `import { type T } from "./x"`
        // where every named binding is type-only.
        if (isRuntimeImport(node)) {
          const spec = staticSpecifier(node.moduleSpecifier);
          if (spec !== undefined) specifiers.push(spec);
        }
      }
      // `import h = require("./helper")` loads the helper exactly like the
      // other spellings. Seeding it in findMockModuleCalls without giving the
      // closure the matching edge left the two halves disagreeing: a helper
      // reachable ONLY this way was never followed, so its mock.module() was
      // never read. Exit 0 with the pool registry replaced, verified in a
      // real `bun test` run.
      if (
        ts.isImportEqualsDeclaration(node) &&
        // `import type h = require("./x")` is erased, like any type-only
        // import. Added as an edge without this guard, it followed a file bun
        // never loads and failed a passing build.
        !node.isTypeOnly &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        const spec = staticSpecifier(node.moduleReference.expression);
        if (spec !== undefined) specifiers.push(spec);
      }
      // require("./x") and await import("./x"), in either quoting style.
      if (ts.isCallExpression(node)) {
        const isRequire =
          ts.isIdentifier(node.expression) &&
          fetchers.has(node.expression.text) &&
          !fetcherShadowedAt(
            node.expression.text,
            node.expression.getStart(source),
          );
        const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        if (isRequire || isImport) {
          const arg = node.arguments[0];
          const spec = staticSpecifier(arg) ?? constSpecifier(arg, source);
          if (spec !== undefined) specifiers.push(spec);
          else if (node.arguments.length > 0) {
            // A computed import target. The closure cannot follow it, so the
            // subtree behind it is unexamined -- recorded rather than skipped
            // in silence, which is how the backtick case stayed invisible.
            unresolvedImports.push(
              `${relative(REPO_ROOT, file)}:${
                source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
              }`,
            );
          }
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(source);

    for (const spec of specifiers) {
      if (!spec.startsWith(".")) continue;
      const written = resolve(file, "..", spec);
      // NodeNext/ESM specifiers name the EMITTED file: `./helper.js` resolves
      // to `helper.ts` on disk. Appending extensions can only ever produce
      // `helper.js.ts`, so the import was silently unresolved and its file
      // never read -- a helper that patches the registry passed the check at
      // exit 0, proven at runtime with the pool fully replaced. Substituting
      // the extension is the other half of resolution.
      const expanded = [written, ...jsToTsBases(written)].flatMap((base) =>
        CANDIDATES.map((suffix) => base + suffix),
      );
      // A DIRECTORY import resolves through its package.json "main" before
      // index.*, and bun honours that for an in-repo directory. Trying only
      // `h`, `h.ts`, and `h/index.ts` meant `import { h } from "./h"` with
      // `h/package.json` naming `poison.ts` resolved to nothing -- and a
      // specifier that resolved to nothing was dropped in silence, on the
      // assumption that a non-file cannot hold a violation. Measured false:
      // exit 0 while `bun test` loaded the file and replaced the pool
      // registry, the #75 failure exactly.
      // "main" comes FIRST, not last. Node and bun consult it BEFORE
      // `<dir>/index.*`, so appending it left an index file shadowing the
      // real target: the check read the decoy, bun ran the poison.
      const main = packageMain(written);
      const candidates = main ? [main, ...expanded] : expanded;

      let resolved = false;
      for (const candidate of candidates) {
        if (!ts.sys.fileExists(candidate)) continue;
        // realpath first: resolve() does not follow symlinks, so a link
        // pointing INTO node_modules produced a candidate string with no
        // "/node_modules/" in it and walked straight through this guard --
        // pulling a 9 MB vendored file into the parse set, and exiting 3 on
        // any dependency whose source does not parse.
        let real = candidate;
        try {
          real = realpathSync(candidate);
        } catch {
          // unreadable link target -- judge the written path
        }
        if (real.includes("/node_modules/")) break;
        // A link pointing outside the repo is not parsed: it is not our code,
        // and following it makes the result depend on the machine. But bun
        // FOLLOWS it and runs whatever is there, so skipping it in silence
        // left a file the runner executes and the check never saw -- measured
        // at exit 0 with the transports registry fully replaced through such a
        // link. Not parsed, and not silent: it is reported as unfollowed, and
        // the run fails on what it could not judge.
        if (!real.startsWith(REPO_ROOT + "/")) {
          unresolvedImports.push(
            `${relative(REPO_ROOT, file)} -> ${spec} (resolves outside the repo)`,
          );
          break;
        }
        // Only code: an imported .json (or .txt fixture) is data, and parsing
        // it as TypeScript turns a normal import into a harness error.
        //
        // An EXTENSIONLESS file is not data -- it has no extension to judge,
        // and bun runs it as code. Skipping it here marked it resolved and
        // never parsed it, so `import "./h/helper"` with an extensionless
        // helper patched the pool at exit 0 (verified: PASS while `bun test`
        // printed the fake's keys). A file is data only when it carries an
        // extension that is not runnable.
        const ext = basename(candidate).includes(".")
          ? candidate.toLowerCase().slice(candidate.lastIndexOf("."))
          : "";
        if (ext !== "" && !RUNNABLE.includes(ext)) {
          resolved = true;
          break;
        }
        if (!seen.has(candidate)) {
          seen.add(candidate);
          queue.push(candidate);
        }
        resolved = true;
        break;
      }
      // Nothing matched. The old code dropped this, reasoning that a
      // specifier resolving to no file cannot hide a violation -- but the
      // check's resolver is not bun's, so "this check found nothing" and
      // "there is nothing" are different statements. Whenever they can
      // differ, the check reports rather than assumes.
      if (!resolved) {
        unresolvedImports.push(
          `${relative(REPO_ROOT, file)} -> ${spec} (this check could not resolve it; bun may still load it)`,
        );
      }
    }
  }
  return { files: [...seen], unresolvedImports };
}

function main(): number {
  if (!ts.sys.directoryExists(SCAN_ROOT)) {
    console.log("HARNESS: repo root not found");
    return 3;
  }

  let files: string[];
  try {
    files = walk(SCAN_ROOT);
  } catch (err) {
    console.log(`HARNESS: could not read the repo -- ${(err as Error).message}`);
    return 3;
  }
  if (files.length === 0) {
    console.log("HARNESS: no runnable source files found");
    return 3;
  }

  // A test's local imports are LOADED by the runner, so a mock.module() in a
  // helper the test imports patches the registry exactly as one in the test
  // does -- and the helper's own name does not match bun's test pattern, so
  // walking entrypoints alone missed it. Follow the local import closure.
  const closure = withLocalImports(files);
  files = closure.files;

  let calls: Call[];
  try {
    calls = files.flatMap(findMockModuleCalls);
  } catch (err) {
    if (err instanceof HarnessError) {
      console.log(`HARNESS: ${err.message}`);
      return 3;
    }
    console.log(`HARNESS: parse failed -- ${(err as Error).message}`);
    return 3;
  }
  let fail = 0;

  // Clause 1: no forbidden target.
  const offenders = calls.filter((c) => {
    if (c.dynamic) return false;
    return isForbiddenFrom(c.target, c.file) !== undefined;
  });

  if (offenders.length === 0) {
    console.log(`CLAUSE no-connection-mocks: PASS (${calls.length} mock.module call(s) inspected across ${files.length} files)`);
  } else {
    console.log("CLAUSE no-connection-mocks: FAIL -- mock.module() patches the module registry for a transport module:");
    for (const o of offenders) {
      console.log(
        `  ${o.file}:${o.line} -> ${o.target}  (${isForbiddenFrom(o.target, o.file)}) via ${o.via}`,
      );
    }
    console.log("  Use a restorable seam instead, and restore it in afterAll:");
    console.log("    src/connection/connect.ts  -> setConnector() / resetConnector()");
    console.log("    src/daemon/transports.ts   -> setPoolTransports() / resetPoolTransports()");
    console.log("  Why: mock.module() is process-global and mock.restore() does NOT undo it (#75).");
    fail = 1;
  }

  // Clause 2: a computed specifier cannot be judged, so it is never waved
  // through -- that would be the easiest bypass of all.
  const dynamic = calls.filter((c) => c.dynamic);
  if (dynamic.length === 0) {
    console.log("CLAUSE no-dynamic-specifier: PASS");
  } else {
    console.log("CLAUSE no-dynamic-specifier: FAIL -- a registry patch this check cannot judge statically:");
    for (const d of dynamic) console.log(`  ${d.file}:${d.line} via ${d.via}`);
    console.log("  Each line above names what could not be resolved. Make it static:");
    console.log("    - non-literal specifier -> pass a string literal");
    console.log("    - reassigned or shadowed name -> use a distinct name for the non-mock value");
    console.log("    - escaped reference -> call mock.module() directly instead of storing it");
    fail = 1;
  }

  // Clause 3 is GONE. It guarded one allowlisted call in
  // tests/cli/daemon-routed-discovery.test.ts, and #86 converted that call
  // onto the setDaemonSchemaClient() seam. The rule is now unconditional:
  // there is no allowed mock.module() target anywhere in this repo, so an
  // exception to reason about no longer exists.
  //
  // Kept as a note rather than deleted silently, because the clause numbering
  // in this file's output is what the lane contract and the probe suite refer
  // to, and a reader comparing the two should see why 3 is absent.
  // Clause 4: an import the closure could not follow means some subtree was
  // never examined, so a PASS would be a claim about files nobody read. Same
  // rule as an unjudgeable specifier, applied to the walk instead of the call.
  if (closure.unresolvedImports.length === 0) {
    console.log("CLAUSE imports-all-followed: PASS");
  } else {
    console.log("CLAUSE imports-all-followed: FAIL -- an import the closure could not read, hiding whatever it loads:");
    for (const u of closure.unresolvedImports) console.log(`  ${u}`);
    console.log("  A computed target: import a literal path instead.");
    console.log("  A target outside the repo: bun follows it and runs it, but this check will not read code it does not own. Vendor it in, or import it by a path inside the repo.");
    fail = 1;
  }

  if (fail !== 0) {
    console.log("RESULT FAIL -- see the failing clause above");
    return 1;
  }
  // Deliberately narrower than "the transports are only substituted through
  // seams". This is static analysis of a dynamic language: six review rounds
  // each found another spelling, and the honest claim is what was inspected,
  // not what is guaranteed. Forge issue #90 tracks the runtime guard that can
  // make the stronger claim.
  console.log(`RESULT PASS -- no forbidden mock.module() found in ${files.length} reachable files`);
  return 0;
}

process.exit(main());
