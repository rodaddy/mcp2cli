/**
 * Backend dispatch for direct (non-daemon) connections.
 *
 * Four CLI commands -- tool-call, schema, service-help, service-discovery --
 * each carried a byte-identical copy of the stdio/http/websocket ternary. That
 * duplication had two costs: a new backend meant editing four call sites, and
 * a test wanting to stub the transports had no seam to do it at, so tests
 * reached for `mock.module()` on src/connection/* instead. Those stubs patch
 * the process-global module registry and are never unwound -- `mock.restore()`
 * does not undo a module replacement -- so every test file that ran afterwards
 * in a single-process `bun test` resolved the stub instead of the real
 * transport. Eight tests under tests/connection/ failed exactly that way, and
 * CI worked around it by running one bun process per test directory (#75).
 *
 * The override below is that missing seam. Tests call `setConnector()` in a
 * scoped setup and restore it in teardown, which is ordinary state a test owns
 * and can put back -- unlike the module registry, which it cannot.
 */
import type { ServiceConfig } from "../config/index.ts";
import { connectToService } from "./client.ts";
import { ConnectionError } from "./errors.ts";
import { connectToHttpService } from "./http-transport.ts";
import type { McpConnection } from "./types.ts";
import { connectToWebSocketService } from "./websocket-transport.ts";

export type Connector = (
  service: ServiceConfig,
  options?: { timeout?: number },
) => Promise<McpConnection>;

/**
 * Connect using the transport the service's backend calls for.
 *
 * An unknown backend throws rather than silently falling through to stdio:
 * a typo'd backend in a config file should fail loudly, not spawn the
 * service's `command` as though no backend had been named.
 *
 * THE DAEMON POOL HAS ITS OWN DISPATCH, DELIBERATELY. `ConnectionPool.connect`
 * in src/daemon/pool.ts branches on the same three backends, and the two are
 * NOT going to be merged (#87, closed as intentional). This one picks a
 * transport and nothing else. The pool's HTTP and WebSocket branches each run
 * a circuit breaker (shouldAttemptHttp / recordSuccess / recordFailure) and a
 * stdio fallback around the connect, while its stdio branch has neither -- so
 * they are three different operations that happen to key off the same field,
 * not one operation written twice. A shared dispatch would have to take hooks
 * for the breaker key, the fallback config, and the logging, which is more
 * indirection than the duplication costs.
 *
 * What that buys is a real obligation: ADDING A BACKEND MEANS EDITING BOTH.
 * Both sites handle exactly http, websocket and stdio -- the three literals in
 * src/config/schema.ts -- and both throw `unsupported_backend` on anything
 * else. Keep that true.
 */
const defaultConnector: Connector = async (service, options) => {
  switch (service.backend) {
    case "http":
      return connectToHttpService(service, options);
    case "websocket":
      return connectToWebSocketService(service, options);
    case "stdio":
      return connectToService(service, options);
    default: {
      const backend = (service as { backend: string }).backend;
      throw new ConnectionError(
        `Unsupported backend: ${backend}`,
        "unsupported_backend",
      );
    }
  }
};

let connector: Connector = defaultConnector;

/** Connect to a service over the transport its backend selects. */
export function connectToBackend(
  service: ServiceConfig,
  options?: { timeout?: number },
): Promise<McpConnection> {
  return connector(service, options);
}

/**
 * Replace the connector, for tests. Returns the PREVIOUS connector, and a
 * caller that may be nested must restore that value rather than calling
 * `resetConnector()`, which jumps straight back to the real transports and
 * would drop an outer override still in effect.
 */
export function setConnector(next: Connector): Connector {
  const previous = connector;
  connector = next;
  return previous;
}

/**
 * Restore the real transport dispatch outright. Correct for a test file that
 * installed the only override; use the value returned by `setConnector()`
 * instead when an override may be nested inside another.
 */
export function resetConnector(): void {
  connector = defaultConnector;
}
