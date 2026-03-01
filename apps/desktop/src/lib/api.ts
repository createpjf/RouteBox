import { getGatewayUrl, getAuthToken } from "./constants";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

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
        throw new ApiError(
          (body as Record<string, string>).error || `HTTP ${res.status}`,
          res.status
        );
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Don't retry POST or 4xx client errors
      const is4xx = err instanceof ApiError && err.status >= 400 && err.status < 500;
      if (options?.method === "POST" || is4xx) {
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

// ── Provider registry (key management) ──────────────────────────────────────

export interface ProviderRegistryEntry {
  name: string;
  format: "openai" | "anthropic";
  hasKey: boolean;
  keySource: "env" | "db" | null;
  maskedKey: string | null;
  isActive: boolean;
}

export interface ProviderRegistryResponse {
  providers: ProviderRegistryEntry[];
}

export interface SetProviderKeyResponse {
  success: boolean;
  provider: string;
}

export interface ValidateKeyResponse {
  valid: boolean;
  error: string | null;
}

// ── Analytics ────────────────────────────────────────────────────────────────

export interface AnalyticsTimeSeriesPoint {
  date: string;
  cost: number;
  tokens: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AnalyticsResponse {
  period: string;
  timeSeries: AnalyticsTimeSeriesPoint[];
  providerBreakdown: { provider: string; requests: number; cost: number; tokens: number }[];
  topModels: { model: string; requests: number; cost: number }[];
  totals: { requests: number; tokens: number; cost: number; avgLatency: number };
}

// ── Budget ───────────────────────────────────────────────────────────────────

export interface BudgetResponse {
  monthly: number;
  spent: number;
  currency: string;
}

// ── Model Preferences ────────────────────────────────────────────────────────

export interface ModelPreference {
  id: number;
  modelPattern: string;
  provider: string;
  action: "pin" | "exclude";
  priority: number;
}

export interface PreferencesResponse {
  preferences: ModelPreference[];
}

// ── Models ───────────────────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  pricing: { input: number; output: number };
}

export interface ProviderModels {
  provider: string;
  models: ModelInfo[];
}

export interface ModelsResponse {
  providers: ProviderModels[];
}

// ── Model Toggles ───────────────────────────────────────────────────────

export interface ModelToggle {
  id: number;
  modelId: string;
  provider: string;
  enabled: boolean;
}

export interface ModelTogglesResponse {
  toggles: ModelToggle[];
}

// ── Routing Rules ───────────────────────────────────────────────────────

export interface RoutingRule {
  id: number;
  name: string;
  matchType: "model_alias" | "content_code" | "content_long" | "content_general";
  matchValue: string;
  targetModel: string;
  targetProvider: string | null;
  priority: number;
  enabled: boolean;
}

export interface RoutingRulesResponse {
  rules: RoutingRule[];
}

export const api = {
  getProviders: () => request<ProvidersResponse>("/api/v1/providers"),
  getModels: () => request<ModelsResponse>("/api/v1/models"),
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

  // Provider key management
  getProviderRegistry: () =>
    request<ProviderRegistryResponse>("/api/v1/providers/registry"),
  setProviderKey: (name: string, apiKey: string) =>
    request<SetProviderKeyResponse>(`/api/v1/providers/${encodeURIComponent(name)}/key`, {
      method: "PUT",
      body: JSON.stringify({ apiKey }),
      retries: 0,
    }),
  deleteProviderKey: (name: string) =>
    request<{ success: boolean }>(`/api/v1/providers/${encodeURIComponent(name)}/key`, {
      method: "DELETE",
      retries: 0,
    }),
  validateProviderKey: (name: string) =>
    request<ValidateKeyResponse>(`/api/v1/providers/${encodeURIComponent(name)}/validate`, {
      method: "POST",
      retries: 0,
    }),

  // Analytics
  getAnalytics: (period = "today") =>
    request<AnalyticsResponse>(`/api/v1/analytics?period=${encodeURIComponent(period)}`),

  // Budget
  getBudget: () => request<BudgetResponse>("/api/v1/budget"),
  setBudget: (monthly: number) =>
    request<{ success: boolean }>("/api/v1/budget", {
      method: "PUT",
      body: JSON.stringify({ monthly }),
      retries: 0,
    }),

  // Model Preferences
  getPreferences: () => request<PreferencesResponse>("/api/v1/preferences"),
  addPreference: (modelPattern: string, provider: string, action: string, priority = 0) =>
    request<{ success: boolean; id: number }>("/api/v1/preferences", {
      method: "POST",
      body: JSON.stringify({ modelPattern, provider, action, priority }),
      retries: 0,
    }),
  removePreference: (id: number) =>
    request<{ success: boolean }>(`/api/v1/preferences/${id}`, {
      method: "DELETE",
      retries: 0,
    }),

  // Model Toggles
  getModelToggles: () => request<ModelTogglesResponse>("/api/v1/model-toggles"),
  setModelToggle: (modelId: string, provider: string, enabled: boolean) =>
    request<{ success: boolean }>("/api/v1/model-toggles", {
      method: "PUT",
      body: JSON.stringify({ modelId, provider, enabled }),
      retries: 0,
    }),

  // Routing Rules
  getRoutingRules: () => request<RoutingRulesResponse>("/api/v1/routing-rules"),
  addRoutingRule: (rule: Omit<RoutingRule, "id">) =>
    request<{ success: boolean; id: number }>("/api/v1/routing-rules", {
      method: "POST",
      body: JSON.stringify(rule),
      retries: 0,
    }),
  updateRoutingRule: (id: number, rule: Omit<RoutingRule, "id">) =>
    request<{ success: boolean }>(`/api/v1/routing-rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(rule),
      retries: 0,
    }),
  removeRoutingRule: (id: number) =>
    request<{ success: boolean }>(`/api/v1/routing-rules/${id}`, {
      method: "DELETE",
      retries: 0,
    }),
};
