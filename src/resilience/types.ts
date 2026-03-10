/**
 * Types for the circuit breaker resilience module.
 * Circuit breaker protects against repeated calls to an unreachable HTTP gateway.
 */

/** Circuit breaker states following the standard pattern. */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Persisted circuit breaker state for a single service.
 * Stored at ~/.cache/mcp2cli/circuit-breaker/{service}.json
 */
export interface CircuitBreakerState {
  /** Current circuit state */
  state: CircuitState;
  /** Number of consecutive failures while circuit is closed */
  failureCount: number;
  /** ISO timestamp of the last failure */
  lastFailureAt: string | null;
  /** ISO timestamp when circuit was opened (null if not open) */
  openedAt: string | null;
  /** ISO timestamp of last successful connection */
  lastSuccessAt: string | null;
}

/** Configuration for circuit breaker behavior. */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit (default: 5) */
  failureThreshold: number;
  /** Cooldown period in ms before a half-open probe is attempted (default: 60000) */
  cooldownMs: number;
}

/** Default circuit breaker configuration. */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 60_000,
};
