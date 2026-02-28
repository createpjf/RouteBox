export interface RealtimeStats {
  requests: number;
  tokens: number;
  cost: number;
  saved: number;
  requestsDelta: number;
  tokensDelta: number;
  costDelta: number;
  sparkline: number[];
  providers: ProviderStatus[];
  balance: number;
  budget: number;
  monthSpend: number;
}

export interface ProviderStatus {
  name: string;
  latency: number;
  isUp: boolean;
  keySource: "byok" | "pool";
  requestsToday: number;
}

export interface BalanceInfo {
  current: number;
  currency: string;
  lowThreshold: number;
}

export interface RoutingStrategy {
  id: string;
  name: string;
  description: string;
  active: boolean;
}

export interface RequestLogEntry {
  id: string;
  timestamp: number;
  provider: string;
  model: string;
  tokens: number;
  cost: number;
  latencyMs: number;
  status: "success" | "error" | "fallback";
  /** Original model before routing */
  requestedModel?: string;
  /** Token breakdown */
  inputTokens?: number;
  outputTokens?: number;
  /** Was this a fallback route? */
  isFallback?: boolean;
  /** Strategy active at request time */
  routingStrategy?: string;
}

export interface TrafficPoint {
  time: string;
  value: number;
}
