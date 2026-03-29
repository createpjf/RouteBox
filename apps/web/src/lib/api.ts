import { API_BASE_URL } from "./constants";
import { getToken, clearToken } from "./auth";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new ApiError("Session expired", 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const errObj = (body as Record<string, unknown>)?.error;
    const errMsg =
      typeof errObj === "string"
        ? errObj
        : (errObj as Record<string, unknown>)?.message ?? `HTTP ${res.status}`;
    throw new ApiError(String(errMsg), res.status);
  }

  return (await res.json()) as T;
}

// ── Auth ──

export interface LoginResponse {
  token: string;
  user: { id: string; email: string; displayName: string; plan: string };
}

export function login(email: string, password: string) {
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function register(email: string, password: string, displayName: string, referralCode?: string) {
  return request<LoginResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, displayName, referralCode }),
  });
}

export function forgotPassword(email: string) {
  return request<{ message: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, password: string) {
  return request<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

// ── Account ──

export interface AccountInfo {
  id: string;
  email: string;
  displayName: string;
  plan: string;
  balanceCents: number;
  bonusCents: number;
  totalDepositedCents: number;
  totalUsedCents: number;
  createdAt: string;
}

export function getAccountInfo() {
  return request<AccountInfo>("/account/me");
}

export interface BalanceResponse {
  balance_cents: number;
  bonus_cents: number;
  total_cents: number;
}

export function getBalance() {
  return request<BalanceResponse>("/account/balance");
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request<{ message: string }>("/account/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function updateProfile(data: { displayName?: string; email?: string }) {
  return request<{ message: string }>("/account/profile", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ── API Keys ──

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  maskedKey: string;
  plainKey?: string;
  createdAt: string;
}

export function getApiKeys() {
  return request<{ keys: ApiKey[] }>("/account/api-keys");
}

export function createApiKey(name: string) {
  return request<{ key: ApiKey }>("/account/api-keys", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function renameApiKey(id: string, name: string) {
  return request<{ message: string }>(`/account/api-keys/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function deleteApiKey(id: string) {
  return request<{ message: string }>(`/account/api-keys/${id}`, {
    method: "DELETE",
  });
}

// ── Subscription ──

export interface SubscriptionInfo {
  plan: string;
  status: string;
  currentPeriodEnd?: string;
}

export function getSubscription() {
  return request<SubscriptionInfo>("/account/subscription");
}

// ── Referral ──

export interface ReferralInfo {
  code: string;
  totalUses: number;
  totalRewardCents: number;
}

export function getReferral() {
  return request<ReferralInfo>("/account/referral");
}

// ── Analytics ──

export interface AnalyticsResponse {
  timeSeries: { date: string; cost: number; tokens: number; requests: number }[];
  providerBreakdown: { provider: string; requests: number; percentage: number }[];
  topModels: { model: string; requests: number; cost: number; percentage: number }[];
  totals: { requests: number; tokens: number; cost: number; avgLatency: number };
}

export function getAnalytics(period: "today" | "7d" | "30d") {
  return request<AnalyticsResponse>(`/account/analytics?period=${period}`);
}

// ── Request history ──

export interface RequestRecord {
  id: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  latencyMs: number;
  status: string;
  createdAt: string;
}

export function getRequests(cursor?: string, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return request<{ requests: RequestRecord[]; nextCursor?: string }>(
    `/account/requests?${params}`
  );
}

// ── Billing ──

export interface CreditPackage {
  id: string;
  name: string;
  priceUsd: number;
  credits: number;
  bonus: number;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  priceUsd: number;
  features: string[];
  monthlyCredits: number;
}

export function getCreditPackages() {
  return request<{ packages: CreditPackage[] }>("/billing/packages");
}

export function getPlans() {
  return request<{ plans: SubscriptionPlan[] }>("/billing/plans");
}

export function createCheckout(packageId: string) {
  return request<{ url: string }>("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ packageId }),
  });
}

export function createSubscription(planId: string) {
  return request<{ url: string }>("/billing/subscribe", {
    method: "POST",
    body: JSON.stringify({ planId }),
  });
}

export function cancelSubscription() {
  return request<{ message: string }>("/billing/cancel-subscription", {
    method: "POST",
  });
}

export function getTransactions(page = 1, limit = 20) {
  return request<{
    transactions: {
      id: string;
      type: string;
      amountCents: number;
      description: string;
      createdAt: string;
    }[];
    total: number;
  }>(`/account/transactions?page=${page}&limit=${limit}`);
}

// ── Models ──

export function getModels() {
  return request<{
    data: { id: string; object: string; owned_by: string }[];
  }>("/v1/models");
}

// ── Marketplace ──

export interface SharedKey {
  id: string;
  providerName: string;
  keyHint: string;
  models: string[];
  rateLimitRpm: number;
  dailyLimit: number;
  status: string;
  totalRequests: number;
  totalEarnedCents: number;
  createdAt: string;
}

export interface MarketplaceListing {
  id: string;
  providerName: string;
  models: string[];
  priceInputPerM: number;
  priceOutputPerM: number;
  description: string;
  avgLatencyMs: number | null;
  successRate: number;
  totalServed: number;
  ownerDisplayName?: string;
}

export function getMySharedKeys() {
  return request<{ keys: SharedKey[] }>("/marketplace/keys");
}

export function registerSharedKey(data: {
  providerName: string;
  apiKey: string;
  models: string[];
  rateLimitRpm?: number;
  dailyLimit?: number;
}) {
  return request<{ key: SharedKey }>("/marketplace/keys", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateSharedKey(
  id: string,
  data: { rateLimitRpm?: number; dailyLimit?: number; status?: string }
) {
  return request<{ message: string }>(`/marketplace/keys/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteSharedKey(id: string) {
  return request<{ message: string }>(`/marketplace/keys/${id}`, {
    method: "DELETE",
  });
}

export function createListing(
  keyId: string,
  data: {
    priceInputPerM: number;
    priceOutputPerM: number;
    description?: string;
  }
) {
  return request<{ listing: MarketplaceListing }>(
    `/marketplace/keys/${keyId}/listings`,
    { method: "POST", body: JSON.stringify(data) }
  );
}

export function getMarketplaceListings(params?: {
  provider?: string;
  model?: string;
  sort?: "price" | "latency" | "rating";
}) {
  const qs = new URLSearchParams();
  if (params?.provider) qs.set("provider", params.provider);
  if (params?.model) qs.set("model", params.model);
  if (params?.sort) qs.set("sort", params.sort);
  return request<{ listings: MarketplaceListing[] }>(
    `/marketplace/listings?${qs}`
  );
}

export interface EarningsSummary {
  totalEarnedCents: number;
  totalRequests: number;
  pendingSettlementCents: number;
}

export function getMyEarnings() {
  return request<EarningsSummary>("/marketplace/earnings");
}

export function getEarningsHistory(page = 1, limit = 20) {
  return request<{
    records: {
      id: string;
      model: string;
      consumerCostCents: number;
      ownerEarningCents: number;
      platformFeeCents: number;
      createdAt: string;
    }[];
    total: number;
  }>(`/marketplace/earnings/history?page=${page}&limit=${limit}`);
}
