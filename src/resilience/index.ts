export type {
  CircuitState,
  CircuitBreakerState,
  CircuitBreakerConfig,
} from "./types.ts";

export { DEFAULT_CIRCUIT_BREAKER_CONFIG } from "./types.ts";

export {
  loadState,
  saveState,
  clearState,
  resolveState,
  recordFailure,
  recordSuccess,
  shouldAttemptHttp,
  getCircuitBreakerDir,
  getStateFilePath,
} from "./circuit-breaker.ts";
