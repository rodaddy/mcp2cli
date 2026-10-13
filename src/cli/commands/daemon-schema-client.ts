/**
 * The daemon schema calls discovery uses, behind a substitutable seam.
 *
 * This file used to be a bare re-export, and the test that needed to stub
 * these two calls did it with `mock.module()`. That patches the process-global
 * module registry, is NOT undone by `mock.restore()`, and stays installed for
 * every test file that runs afterwards -- so the failures surface in unrelated
 * files (one patch on src/daemon/pool.ts caused 50 of them).
 *
 * Same shape as `setConnector`/`resetConnector` in src/connection/connect.ts,
 * so there is one substitution pattern in this codebase rather than two.
 */
import {
  listToolsViaDaemon as realListTools,
  getSchemaViaDaemon as realGetSchema,
} from "../../process/index.ts";

type ListTools = typeof realListTools;
type GetSchema = typeof realGetSchema;

let listImpl: ListTools = realListTools;
let schemaImpl: GetSchema = realGetSchema;

/**
 * Substitute the daemon schema calls. Pair every call with
 * `resetDaemonSchemaClient()` in an `afterAll`, or the substitution leaks into
 * later tests exactly the way the registry patch did.
 */
export function setDaemonSchemaClient(impl: {
  listToolsViaDaemon?: ListTools;
  getSchemaViaDaemon?: GetSchema;
}): void {
  if (impl.listToolsViaDaemon) listImpl = impl.listToolsViaDaemon;
  if (impl.getSchemaViaDaemon) schemaImpl = impl.getSchemaViaDaemon;
}

/** Put the real daemon calls back. */
export function resetDaemonSchemaClient(): void {
  listImpl = realListTools;
  schemaImpl = realGetSchema;
}

export const listToolsViaDaemon: ListTools = (...args) => listImpl(...args);
export const getSchemaViaDaemon: GetSchema = (...args) => schemaImpl(...args);
