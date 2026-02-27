import { getGatewayUrl, getAuthToken } from "./constants";

async function request<T>(
  path: string,
  options?: RequestInit & { retries?: number }
): Promise<T> {
  const maxRetries = options?.retries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = getAuthToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${getGatewayUrl()}${path}`, {
        ...options,
        headers,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>).error || `HTTP ${res.status}`
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Don't retry POST or 4xx errors
      if (options?.method === "POST" || lastError.message.includes("HTTP 4")) {
        break;
      }
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  throw lastError!;
}

export interface ProvidersResponse {
  providers: {
    name: string;
    latency: number;
    isUp: boolean;
    keySource: "byok" | "pool";
    requestsToday: number;
  }[];
}

export interface BalanceResponse {
  current: number;
  currency: string;
  lowThreshold: number;
}

export interface KeysResponse {
  keys: {
    id: string;
    name: string;
    prefix: string;
    maskedKey: string;
    plainKey: string;
    createdAt: string;
  }[];
}

export interface RoutingResponse {
  current: string;
  strategies: {
    id: string;
    name: string;
    description: string;
  }[];
}

export interface TrafficStatusResponse {
  paused: boolean;
}

export const api = {
  getProviders: () => request<ProvidersResponse>("/api/v1/providers"),
  getBalance: () => request<BalanceResponse>("/api/v1/balance"),
  getKeys: () => request<KeysResponse>("/api/v1/keys"),
  getRouting: () => request<RoutingResponse>("/api/v1/routing"),
  setRouting: (strategyId: string) =>
    request("/api/v1/routing", {
      method: "PUT",
      body: JSON.stringify({ strategy_id: strategyId }),
      retries: 0,
    }),
  pauseTraffic: () =>
    request("/api/v1/traffic/pause", { method: "POST", retries: 0 }),
  resumeTraffic: () =>
    request("/api/v1/traffic/resume", { method: "POST", retries: 0 }),
  getTrafficStatus: () =>
    request<TrafficStatusResponse>("/api/v1/traffic/status"),
};
