/**
 * Runtime guard: refuse a module-registry patch on a transport module.
 *
 * Loaded by `bunfig.toml` [test].preload, so it runs before any test file in
 * every `bun test` invocation -- CI, a bare local run, and a single-file run
 * alike.
 *
 * WHY THIS EXISTS ALONGSIDE THE STATIC CHECK
 *
 * `scripts/done-means/no-connection-module-mocks.ts` asks whether a call was
 * SPELLED in a way it recognises. Nine adversarial review rounds each found a
 * spelling nobody had listed, and from round 7 on, every finding was a defect
 * in a previous round's fix. The enumeration does not converge, because the
 * set of ways to obtain a function is not finite.
 *
 * This guard replaces the function instead of reading the source, so it does
 * not care how the caller got hold of it. Measured against every spelling that
 * cost the static check a round -- destructuring, computed access,
 * `Reflect.get`, `Reflect.apply`, aliased `require`, `import bt = require`,
 * a nine-deep alias chain -- all blocked, including `Reflect.get`, which the
 * static check documents as a limit it cannot reach.
 *
 * It also survives the recovery paths: `mock.restore()`, `await
 * import("bun:test")`, and `require("bun:test")` all return this patched
 * namespace rather than the original (measured on bun 1.3.14).
 *
 * The two are not redundant. They fail at different times:
 *
 *   static check -- BEFORE `bun test` runs, naming file and line. That is the
 *     property the original leak needed: the original failure surfaced in unrelated files
 *     and took a session to trace back to its cause.
 *   this guard -- DURING the run, at the offending call, in the file that
 *     made it. Later, but unbypassable.
 *
 * WHY THE PATTERN IS DUPLICATED HERE
 *
 * A preload cannot import from `scripts/`, which is outside the test tree and
 * is checked by `tsc` under a different root. The list is small and changes
 * approximately never; `no-connection-module-mocks.probe.ts` asserts the two
 * agree, so a drift fails the probe suite rather than silently opening a hole.
 */
import { mock } from "bun:test";

/**
 * The protected modules, as repo-relative paths without extension. Must match
 * PROTECTED_PATHS in scripts/done-means/no-connection-module-mocks.ts.
 */
const PROTECTED = ["src/connection", "src/daemon/pool", "src/daemon/transports"];

/**
 * Normalise a specifier to a repo-relative path for comparison: strip a query
 * or fragment, percent-decode, drop the extension, and remove leading `./`,
 * `../` and `src/` segments so `../../src/daemon/pool.ts` and
 * `src/daemon/pool.js` compare equal.
 */
function normalise(specifier: string): string {
  let s = String(specifier).split("?")[0]!.split("#")[0]!;
  try {
    s = decodeURIComponent(s);
  } catch {
    // not a valid escape sequence -- judge the literal text
  }
  s = s.replace(/\.[a-z]+$/i, "");
  s = s.replace(/^(\.\.?\/)+/, "");
  const src = s.indexOf("src/");
  return src === -1 ? s : s.slice(src);
}

function isProtected(specifier: string): string | undefined {
  const path = normalise(specifier);
  return PROTECTED.find((p) => path === p || path.startsWith(p + "/"));
}

const real = mock.module.bind(mock);

(mock as unknown as { module: unknown }).module = (
  specifier: string,
  factory: unknown,
): unknown => {
  const hit = isProtected(specifier);
  if (hit !== undefined) {
    throw new Error(
      `Forbidden module-registry patch: ${specifier} (${hit}).\n` +
        `\n` +
        `mock.module() on a transport module is process-global and is NOT\n` +
        `undone by mock.restore(), so it stays installed for every test file\n` +
        `that runs after this one -- and the failures surface THERE, not here\n` +
        `(50 unrelated failures from one patch on src/daemon/pool.ts).\n` +
        `\n` +
        `Use the injectable seam instead. See tests/connection/ for the\n` +
        `pattern: substitute in beforeEach, restore in afterEach.`,
    );
  }
  return real(specifier, factory as never);
};

export {};
