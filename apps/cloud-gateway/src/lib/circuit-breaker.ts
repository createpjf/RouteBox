// ---------------------------------------------------------------------------
// Circuit Breaker — per-provider-key failure isolation
// State machine: CLOSED → OPEN → HALF_OPEN → CLOSED
// ---------------------------------------------------------------------------

import { log } from "./logger";
import { incCounter, setGauge } from "./metrics";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerConfig {
  /** Consecutive failures to trip the breaker (default: 5) */
  failureThreshold: number;
  /** Failure rate (0-1) over the window to trip (default: 0.5) */
  failureRateThreshold: number;
  /** Minimum requests in window before rate-based tripping (default: 10) */
  failureRateMinRequests: number;
  /** Sliding window size in ms for failure rate calculation (default: 60_000) */
  windowMs: number;
  /** Time in ms before allowing a probe in OPEN state (default: 30_000) */
  recoveryTimeoutMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  failureRateThreshold: 0.5,
  failureRateMinRequests: 10,
  windowMs: 60_000,
  recoveryTimeoutMs: 30_000,
};

interface RequestOutcome {
  timestamp: number;
  success: boolean;
}

export class CircuitBreaker {
  readonly id: string;
  private state: CircuitState = "closed";
  private config: CircuitBreakerConfig;
  private consecutiveFailures = 0;
  private openedAt = 0;
  private outcomes: RequestOutcome[] = [];

  constructor(id: string, config?: Partial<CircuitBreakerConfig>) {
    this.id = id;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Current state (auto-transitions OPEN → HALF_OPEN on recovery timeout) */
  getState(): CircuitState {
    if (
      this.state === "open" &&
      Date.now() - this.openedAt >= this.config.recoveryTimeoutMs
    ) {
      this.transitionTo("half_open");
    }
    return this.state;
  }

  /** Snapshot of internal state for monitoring */
  getSnapshot(): { consecutiveFailures: number; openedAt: number; successRate: number; totalRequests: number } {
    this.pruneOutcomes();
    const total = this.outcomes.length;
    const successes = total > 0 ? this.outcomes.filter((o) => o.success).length : 0;
    return {
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
      successRate: total > 0 ? successes / total : 1,
      totalRequests: total,
    };
  }

  /** Can we send a request through this breaker? */
  canRequest(): boolean {
    const s = this.getState();
    return s === "closed" || s === "half_open";
  }

  /** Record a successful request */
  onSuccess(): void {
    this.consecutiveFailures = 0;
    this.recordOutcome(true);

    if (this.state === "half_open") {
      this.transitionTo("closed");
    }
  }

  /** Record a failed request (network error or 5xx) */
  onFailure(): void {
    this.consecutiveFailures++;
    this.recordOutcome(false);

    if (this.state === "half_open") {
      this.transitionTo("open");
      return;
    }

    if (this.state === "closed") {
      // Check consecutive failure threshold
      if (this.consecutiveFailures >= this.config.failureThreshold) {
        this.transitionTo("open");
        return;
      }

      // Check failure rate threshold
      this.pruneOutcomes();
      if (this.outcomes.length >= this.config.failureRateMinRequests) {
        const failures = this.outcomes.filter((o) => !o.success).length;
        const rate = failures / this.outcomes.length;
        if (rate >= this.config.failureRateThreshold) {
          this.transitionTo("open");
        }
      }
    }
  }

  private recordOutcome(success: boolean): void {
    this.outcomes.push({ timestamp: Date.now(), success });
    if (this.outcomes.length > 200) {
      this.pruneOutcomes();
    }
  }

  private pruneOutcomes(): void {
    const cutoff = Date.now() - this.config.windowMs;
    this.outcomes = this.outcomes.filter((o) => o.timestamp > cutoff);
  }

  private transitionTo(newState: CircuitState): void {
    const prevState = this.state;
    if (prevState === newState) return;
    this.state = newState;

    try { onStateChange?.(this.id, prevState, newState); }
    catch (err) { log.warn("circuit_breaker_hook_error", { provider: this.id, error: err instanceof Error ? err.message : String(err) }); }

    if (newState === "open") {
      this.openedAt = Date.now();
      incCounter("circuit_breaker_trips_total", { provider: this.id });
      log.warn("circuit_breaker_opened", {
        provider: this.id,
        consecutiveFailures: this.consecutiveFailures,
        prevState,
      });
    } else if (newState === "closed") {
      this.consecutiveFailures = 0;
      this.outcomes = [];
      log.info("circuit_breaker_closed", { provider: this.id, prevState });
    } else if (newState === "half_open") {
      log.info("circuit_breaker_half_open", { provider: this.id });
    }

    const stateValue =
      newState === "closed" ? 0 : newState === "half_open" ? 1 : 2;
    setGauge(`circuit_breaker_state_${sanitize(this.id)}`, stateValue);
  }
}

/** Sanitize provider ID for use in metric names */
function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

// ---------------------------------------------------------------------------
// Global registry of circuit breakers (keyed by provider instanceId)
// ---------------------------------------------------------------------------

const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  id: string,
  config?: Partial<CircuitBreakerConfig>,
): CircuitBreaker {
  let cb = breakers.get(id);
  if (!cb) {
    cb = new CircuitBreaker(id, config);
    breakers.set(id, cb);
  }
  return cb;
}

/** Get snapshot of all circuit breaker states (for admin monitoring) */
export function getAllBreakerStates(): Array<{
  id: string;
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
  recentSuccessRate: number;
  recentRequests: number;
}> {
  const result: ReturnType<typeof getAllBreakerStates> = [];
  for (const [, cb] of breakers) {
    const state = cb.getState();
    const snapshot = cb.getSnapshot();
    result.push({
      id: cb.id,
      state,
      consecutiveFailures: snapshot.consecutiveFailures,
      openedAt: snapshot.openedAt || null,
      recentSuccessRate: snapshot.successRate,
      recentRequests: snapshot.totalRequests,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// State change hook — for alerting
// ---------------------------------------------------------------------------

type BreakerHook = (id: string, from: CircuitState, to: CircuitState) => void;
let onStateChange: BreakerHook | null = null;

export function setCircuitBreakerHook(hook: BreakerHook): void {
  onStateChange = hook;
}
