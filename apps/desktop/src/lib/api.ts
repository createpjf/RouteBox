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
        const errObj = (body as any)?.error;
        const errMsg =
          typeof errObj === "string"
            ? errObj
            : errObj?.message ?? `HTTP ${res.status}`;
        throw new ApiError(errMsg, res.status);
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
  isLocal?: boolean;
  baseUrl?: string;
  modelCount?: number;
}

// ── Local Providers ──────────────────────────────────────────────────────────

export interface LocalProviderInfo {
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  isOnline: boolean;
  modelCount: number;
  models: string[];
  lastChecked: number;
}

export interface LocalProvidersResponse {
  providers: LocalProviderInfo[];
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
  active: boolean;
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

// ── Cloud Auth / Account / Billing types ─────────────────────────────────

export interface CloudAuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    displayName: string | null;
    plan: string;
    balanceCents: number;
  };
}

export interface CloudAccountResponse {
  id: string;
  email: string;
  displayName: string | null;
  plan: string;
  balanceCents: number;
  totalDepositedCents: number;
  totalUsedCents: number;
  createdAt: string;
}

export interface CloudBalanceResponse {
  balance_cents: number;
}

export interface CloudCreditPackage {
  id: string;
  amount: number;
  credits: number;
  label: string;
  bonus?: string;
}

export interface CloudPackagesResponse {
  packages: CloudCreditPackage[];
}

export interface CloudCheckoutResponse {
  url: string;
  sessionId: string;
}

export interface CloudTransaction {
  id: string;
  type: string;
  amountCents: number;
  balanceAfterCents: number;
  description: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
}

export interface CloudTransactionsResponse {
  transactions: CloudTransaction[];
}

export interface CloudSubscriptionPlan {
  id: string;
  label: string;
  monthlyPrice: number;   // cents
  markup: number;          // multiplier e.g. 1.25
  features: string[];
  checkoutUrl?: string;
}

export interface CloudPlansResponse {
  plans: CloudSubscriptionPlan[];
}

export interface CloudReferralResponse {
  code: string;
  uses: number;
  totalRewardCents: number;
}

export interface CloudAnnouncement {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "error";
  startsAt: string;
  endsAt: string | null;
}

export interface CloudAnnouncementResponse {
  announcement: CloudAnnouncement | null;
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

  // Local providers
  getLocalProviders: () =>
    request<LocalProvidersResponse>("/api/v1/local-providers"),
  setLocalProviderUrl: (name: string, baseUrl: string, apiKey?: string) =>
    request<LocalProviderInfo>(`/api/v1/local-providers/${encodeURIComponent(name)}/url`, {
      method: "PUT",
      body: JSON.stringify({ baseUrl, ...(apiKey !== undefined ? { apiKey } : {}) }),
      retries: 0,
    }),
  refreshLocalProvider: (name: string) =>
    request<LocalProviderInfo>(`/api/v1/local-providers/${encodeURIComponent(name)}/refresh`, {
      method: "POST",
      retries: 0,
    }),

  // V2: Usage
  getUsageToday: () => request<UsageTodayResponse>("/api/v1/usage/today"),
  getUsageMonth: () => request<UsageMonthResponse>("/api/v1/usage/month"),
  getUsageWeekly: () => request<WeeklyTrendRow[]>("/api/v1/usage/weekly"),
  getUsageModels: () => request<ModelBreakdownRow[]>("/api/v1/usage/models"),
  getUsageSuggestions: () => request<UsageSuggestion[]>("/api/v1/usage/suggestions"),

  // V2: Conversations
  getConversations: () => request<ConversationsResponse>("/api/v1/conversations"),
  createConversation: (title: string, model: string) =>
    request<ConversationDetail>("/api/v1/conversations", {
      method: "POST",
      body: JSON.stringify({ title, model }),
      retries: 0,
    }),
  getConversation: (id: string) =>
    request<ConversationDetail>(`/api/v1/conversations/${encodeURIComponent(id)}`),
  deleteConversation: (id: string) =>
    request<{ success: boolean }>(`/api/v1/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      retries: 0,
    }),
  updateConversation: (id: string, data: { title?: string; pinned?: boolean; archived?: boolean }) =>
    request<{ success: boolean }>(`/api/v1/conversations/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
      retries: 0,
    }),
  sendMessage: (conversationId: string, msg: { role: string; content: string; model?: string; provider?: string; inputTokens?: number; outputTokens?: number; cost?: number; latencyMs?: number }) =>
    request<MessageResponse>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: JSON.stringify(msg),
      retries: 0,
    }),

  // V2: Web Search
  getSearchStatus: () => request<SearchStatusResponse>("/api/v1/search/status"),
  setSearchKey: (apiKey: string) =>
    request<{ success: boolean }>("/api/v1/search/key", {
      method: "PUT",
      body: JSON.stringify({ apiKey }),
      retries: 0,
    }),
  deleteSearchKey: () =>
    request<{ success: boolean }>("/api/v1/search/key", {
      method: "DELETE",
      retries: 0,
    }),

  // V2: Spotlight
  getSpotlightHistory: (limit = 3) =>
    request<SpotlightHistoryResponse>(`/api/v1/spotlight/history?limit=${limit}`),
  saveSpotlightEntry: (data: { prompt: string; response: string; model?: string; provider?: string; cost?: number; tokens?: number; latencyMs?: number }) =>
    request<SpotlightEntryResponse>("/api/v1/spotlight/history", {
      method: "POST",
      body: JSON.stringify(data),
      retries: 0,
    }),

  // ── Cloud Auth ──────────────────────────────────────────────────────────
  cloudRegister: (email: string, password: string, name?: string, referralCode?: string) =>
    request<CloudAuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name, ...(referralCode ? { referralCode } : {}) }),
      retries: 0,
    }),
  cloudLogin: (email: string, password: string) =>
    request<CloudAuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      retries: 0,
    }),
  cloudGetMe: () =>
    request<{ user: CloudAccountResponse }>("/auth/me"),

  // ── Cloud Account ───────────────────────────────────────────────────────
  cloudGetAccount: () =>
    request<CloudAccountResponse>("/account/me"),
  cloudGetBalance: () =>
    request<CloudBalanceResponse>("/account/balance"),
  cloudGetTransactions: (limit = 50, offset = 0) =>
    request<CloudTransactionsResponse>(`/account/transactions?limit=${limit}&offset=${offset}`),

  // ── Cloud Billing ───────────────────────────────────────────────────────
  cloudGetPackages: () =>
    request<CloudPackagesResponse>("/billing/packages"),
  cloudCreateCheckout: (packageId: string) =>
    request<CloudCheckoutResponse>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ packageId }),
      retries: 0,
    }),

  // ── Cloud Analytics ─────────────────────────────────────────────────────
  cloudGetAnalytics: (period = "today") =>
    request<AnalyticsResponse>(`/account/analytics?period=${period}`),

  // ── Cloud Subscription ──────────────────────────────────────────────────
  cloudGetPlans: () =>
    request<CloudPlansResponse>("/billing/plans"),
  cloudSubscribe: (planId: string) =>
    request<CloudCheckoutResponse>("/billing/subscribe", {
      method: "POST",
      body: JSON.stringify({ planId }),
      retries: 0,
    }),
  cloudCancelSubscription: () =>
    request<{ success: boolean }>("/billing/cancel-subscription", {
      method: "POST",
      retries: 0,
    }),

  // ── Cloud Referral ──────────────────────────────────────────────────────
  cloudGetReferral: () =>
    request<CloudReferralResponse>("/account/referral"),

  // ── Cloud Announcement ──────────────────────────────────────────────────
  cloudGetAnnouncement: () =>
    request<CloudAnnouncementResponse>("/account/announcement"),
};

// V2 response types

export interface UsageTodayResponse { requests: number; tokens: number; cost: number; saved: number }
export interface UsageMonthResponse { requests: number; tokens: number; cost: number; budgetPct: number }
export interface WeeklyTrendRow { date: string; cost: number; requests: number }
export interface ModelBreakdownRow { model: string; requests: number; cost: number; pct: number }
export interface UsageSuggestion { message: string; savingsEstimate?: string }

export interface ConversationSummary {
  id: string; title: string; model: string; msg_count: number;
  total_cost: number; pinned: number; updated_at: number;
}
export interface ConversationsResponse { conversations: ConversationSummary[] }
export interface ConversationDetail extends ConversationSummary {
  messages: MessageResponse[];
}
export interface MessageResponse {
  id: string; conversation_id: string; role: string; content: string;
  model: string; provider: string; input_tokens: number; output_tokens: number;
  cost: number; latency_ms: number; created_at: number;
}
export interface SearchStatusResponse { enabled: boolean; hasKey: boolean }
export interface SpotlightHistoryResponse { entries: SpotlightEntryResponse[] }
export interface SpotlightEntryResponse {
  id: string; prompt: string; response: string; model: string;
  provider: string; cost: number; tokens: number; latency_ms: number; created_at: number;
}
