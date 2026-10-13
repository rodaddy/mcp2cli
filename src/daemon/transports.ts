/**
 * The transports the connection pool dials through.
 *
 * The pool cannot use connection/connect.ts: it does not simply pick a
 * transport by backend, it wraps each one in circuit-breaker accounting and
 * stdio-fallback logic, and needs to name the three individually. But its
 * tests still need to substitute them, and doing that with `mock.module()`
 * patches the process-global module registry with no way back -- `mock.restore()`
 * does not undo a module replacement -- which leaked stubs into every later
 * file in a single-process `bun test`.
 *
 * So the pool dials through this object instead of importing the transports
 * directly. A test swaps the fields it needs and restores them in teardown;
 * ordinary state it owns, rather than a registry it cannot unwind. The pool's
 * fallback and circuit-breaker logic is untouched by this indirection.
 */
import { connectToService } from "../connection/client.ts";
import { connectToHttpService } from "../connection/http-transport.ts";
import { connectToWebSocketService } from "../connection/websocket-transport.ts";

export interface PoolTransports {
  connectToService: typeof connectToService;
  connectToHttpService: typeof connectToHttpService;
  connectToWebSocketService: typeof connectToWebSocketService;
}

const defaults: PoolTransports = {
  connectToService,
  connectToHttpService,
  connectToWebSocketService,
};

export const poolTransports: PoolTransports = { ...defaults };

/**
 * Replace one or more transports, for tests. Returns the PREVIOUS values of
 * the fields it overwrote, so a nested caller can put them back exactly;
 * `resetPoolTransports()` restores the real transports outright and would
 * drop an outer override still in effect.
 *
 * Every caller must restore in `afterAll`. This is a module-level singleton:
 * unlike `mock.module()` there IS a way back, but nothing forces you to take
 * it, and a file that overrides without restoring reintroduces the registry leak in a
 * quieter form.
 */
export function setPoolTransports(
  overrides: Partial<PoolTransports>,
): Partial<PoolTransports> {
  const previous: Partial<PoolTransports> = {};
  for (const key of Object.keys(overrides) as (keyof PoolTransports)[]) {
    previous[key] = poolTransports[key] as never;
  }
  Object.assign(poolTransports, overrides);
  return previous;
}

/**
 * Restore the real transports outright. Correct for a test file that
 * installed the only override; use the value returned by
 * `setPoolTransports()` instead when an override may be nested.
 */
export function resetPoolTransports(): void {
  Object.assign(poolTransports, defaults);
}
