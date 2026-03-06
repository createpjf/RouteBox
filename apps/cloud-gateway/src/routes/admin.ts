// ---------------------------------------------------------------------------
// Admin API routes — GET /admin/*
// Protected by admin-auth middleware (requires JWT with admin email)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { adminAuth } from "../middleware/admin-auth";
import {
  getAdminStats,
  getAdminUsers,
  getAdminTransactions,
  getAdminUsageByModel,
  getAdminUsageByProvider,
  getAdminDailyTrend,
  getAdminRegistrationTrend,
  getAdminRevenueTrend,
  getAdminReferralStats,
  getAdminTopReferrers,
  getAdminRecentReferralClaims,
  updateUserPlan,
  adjustUserBalance,
} from "../lib/admin-queries";
import type { CloudEnv } from "../types";

const app = new Hono<CloudEnv>();

// All admin routes require admin auth
app.use("/*", adminAuth);

// ── GET /stats — overview dashboard numbers ────────────────────────────────

app.get("/stats", async (c) => {
  const stats = await getAdminStats();
  return c.json(stats);
});

// ── GET /users — user list with balance + usage count ──────────────────────

app.get("/users", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const offset = Number(c.req.query("offset") ?? 0);
  const search = c.req.query("search") ?? "";
  const { users, total } = await getAdminUsers(limit, offset, search);
  return c.json({ users, total, limit, offset });
});

// ── GET /transactions — recent transactions (all users) ────────────────────

app.get("/transactions", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);
  const { transactions, total } = await getAdminTransactions(limit, offset);
  return c.json({ transactions, total, limit, offset });
});

// ── GET /usage/models — usage breakdown by model ───────────────────────────

app.get("/usage/models", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 7), 90);
  const models = await getAdminUsageByModel(days);
  return c.json({ models, days });
});

// ── GET /usage/providers — usage breakdown by provider ─────────────────────

app.get("/usage/providers", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 7), 90);
  const providers = await getAdminUsageByProvider(days);
  return c.json({ providers, days });
});

// ── GET /usage/trend — daily usage trend ───────────────────────────────────

app.get("/usage/trend", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 30), 90);
  const trend = await getAdminDailyTrend(days);
  return c.json({ trend, days });
});

// ── GET /registrations/trend — daily registration trend ────────────────────

app.get("/registrations/trend", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 30), 90);
  const trend = await getAdminRegistrationTrend(days);
  return c.json({ trend, days });
});

// ── GET /revenue/trend — daily revenue trend ───────────────────────────────

app.get("/revenue/trend", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 30), 90);
  const trend = await getAdminRevenueTrend(days);
  return c.json({ trend, days });
});

// ── GET /referrals/stats — referral program overview ─────────────────────

app.get("/referrals/stats", async (c) => {
  const stats = await getAdminReferralStats();
  return c.json(stats);
});

// ── GET /referrals/top — top referrers leaderboard ──────────────────────

app.get("/referrals/top", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
  const referrers = await getAdminTopReferrers(limit);
  return c.json({ referrers });
});

// ── GET /referrals/claims — recent referral claims ──────────────────────

app.get("/referrals/claims", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const claims = await getAdminRecentReferralClaims(limit);
  return c.json({ claims });
});

// ── PATCH /users/:id — update user plan ───────────────────────────────────

app.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ plan?: string }>();
  if (!body.plan) {
    return c.json({ error: { message: "plan is required", type: "validation_error" } }, 400);
  }
  const validPlans = ["free", "pro"];
  if (!validPlans.includes(body.plan)) {
    return c.json({ error: { message: "plan must be 'free' or 'pro'", type: "validation_error" } }, 400);
  }
  try {
    await updateUserPlan(id, body.plan);
    return c.json({ success: true });
  } catch {
    return c.json({ error: { message: "Failed to update user plan", type: "server_error" } }, 500);
  }
});

// ── POST /users/:id/adjust — adjust user balance ─────────────────────────

app.post("/users/:id/adjust", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ amountCents: number; reason: string }>();
  if (typeof body.amountCents !== "number" || body.amountCents === 0) {
    return c.json({ error: { message: "amountCents must be a non-zero number", type: "validation_error" } }, 400);
  }
  if (!body.reason || typeof body.reason !== "string") {
    return c.json({ error: { message: "reason is required", type: "validation_error" } }, 400);
  }
  try {
    const { newBalance } = await adjustUserBalance(id, body.amountCents, body.reason);
    return c.json({ success: true, newBalance });
  } catch {
    return c.json({ error: { message: "Failed to adjust balance", type: "server_error" } }, 500);
  }
});

// ── Provider Keys CRUD ──────────────────────────────────────────────────

app.get("/provider-keys", async (c) => {
  const { listProviderKeys } = await import("../lib/provider-config");
  const keys = await listProviderKeys();
  return c.json({ keys });
});

app.post("/provider-keys", async (c) => {
  const { createProviderKey, reloadProviders } = await import("../lib/provider-config");
  const body = await c.req.json<{
    providerName: string;
    apiKey: string;
    baseUrl?: string;
    label?: string;
  }>();
  if (!body.providerName || !body.apiKey) {
    return c.json({ error: { message: "providerName and apiKey required", type: "validation_error" } }, 400);
  }
  const key = await createProviderKey(body.providerName, body.apiKey, body.baseUrl, body.label);
  await reloadProviders();
  return c.json(key, 201);
});

app.patch("/provider-keys/:id", async (c) => {
  const { updateProviderKey, reloadProviders } = await import("../lib/provider-config");
  const id = c.req.param("id");
  const body = await c.req.json<{
    apiKey?: string;
    baseUrl?: string;
    label?: string;
    isActive?: boolean;
  }>();
  const key = await updateProviderKey(id, body);
  if (!key) return c.json({ error: { message: "Key not found", type: "not_found" } }, 404);
  await reloadProviders();
  return c.json(key);
});

app.delete("/provider-keys/:id", async (c) => {
  const { deleteProviderKey, reloadProviders } = await import("../lib/provider-config");
  const id = c.req.param("id");
  await deleteProviderKey(id);
  await reloadProviders();
  return c.json({ success: true });
});

// ── Provider Access Control ─────────────────────────────────────────────

app.get("/provider-access", async (c) => {
  const { getProviderAccess } = await import("../lib/provider-config");
  const providers = await getProviderAccess();
  return c.json({ providers });
});

app.put("/provider-access/:providerName", async (c) => {
  const { setProviderAccess, loadProviderAccess } = await import("../lib/provider-config");
  const providerName = c.req.param("providerName");
  const body = await c.req.json<{ isEnabled: boolean; allowedPlans: string[] }>();
  const validPlans = ["all", "free", "pro"];
  if (!Array.isArray(body.allowedPlans) || !body.allowedPlans.every((p: string) => validPlans.includes(p))) {
    return c.json({ error: { message: "allowedPlans must be array of 'all', 'free', 'pro'", type: "validation_error" } }, 400);
  }
  await setProviderAccess(providerName, body.isEnabled, body.allowedPlans);
  await loadProviderAccess();
  return c.json({ success: true });
});

// ── Model Registry CRUD ─────────────────────────────────────────────────

app.get("/models/registry", async (c) => {
  const { listModels } = await import("../lib/model-registry");
  const models = await listModels();
  return c.json({ models });
});

app.get("/models/registry/:id", async (c) => {
  const { getModel } = await import("../lib/model-registry");
  const model = await getModel(c.req.param("id"));
  if (!model) return c.json({ error: { message: "Model not found", type: "not_found" } }, 404);
  return c.json(model);
});

app.post("/models/registry", async (c) => {
  const { createModel, reloadRegistry } = await import("../lib/model-registry");
  const body = await c.req.json<Record<string, unknown>>();

  // Validation
  if (!body.modelId || typeof body.modelId !== "string") {
    return c.json({ error: { message: "modelId is required", type: "validation_error" } }, 400);
  }
  if (!body.provider || typeof body.provider !== "string") {
    return c.json({ error: { message: "provider is required", type: "validation_error" } }, 400);
  }
  if (!body.displayName || typeof body.displayName !== "string") {
    return c.json({ error: { message: "displayName is required", type: "validation_error" } }, 400);
  }

  const validStatuses = ["active", "beta", "deprecated"];
  if (body.status && !validStatuses.includes(body.status as string)) {
    return c.json({ error: { message: "status must be active, beta, or deprecated", type: "validation_error" } }, 400);
  }
  const validTiers = ["flagship", "fast"];
  if (body.tier && !validTiers.includes(body.tier as string)) {
    return c.json({ error: { message: "tier must be flagship or fast", type: "validation_error" } }, 400);
  }

  // Score range validation
  for (const field of ["quality", "speed", "costEfficiency", "codeStrength"]) {
    const val = body[field];
    if (val !== undefined && (typeof val !== "number" || val < 0 || val > 1)) {
      return c.json({ error: { message: `${field} must be a number between 0 and 1`, type: "validation_error" } }, 400);
    }
  }

  try {
    const model = await createModel(body as any);
    reloadRegistry();
    return c.json(model, 201);
  } catch (err: any) {
    if (err.message?.includes("duplicate key") || err.message?.includes("unique")) {
      return c.json({ error: { message: "A model with this model_id already exists", type: "conflict" } }, 409);
    }
    throw err;
  }
});

app.patch("/models/registry/:id", async (c) => {
  const { updateModel, reloadRegistry } = await import("../lib/model-registry");
  const id = c.req.param("id");
  const body = await c.req.json<Record<string, unknown>>();

  // Score range validation
  for (const field of ["quality", "speed", "costEfficiency", "codeStrength"]) {
    const val = body[field];
    if (val !== undefined && (typeof val !== "number" || val < 0 || val > 1)) {
      return c.json({ error: { message: `${field} must be a number between 0 and 1`, type: "validation_error" } }, 400);
    }
  }

  const model = await updateModel(id, body as any);
  if (!model) return c.json({ error: { message: "Model not found", type: "not_found" } }, 404);
  reloadRegistry();
  return c.json(model);
});

app.delete("/models/registry/:id", async (c) => {
  const { deleteModel, reloadRegistry } = await import("../lib/model-registry");
  const deleted = await deleteModel(c.req.param("id"));
  if (!deleted) return c.json({ error: { message: "Model not found", type: "not_found" } }, 404);
  reloadRegistry();
  return c.json({ success: true });
});

app.post("/models/registry/reload", async (c) => {
  const { reloadRegistry } = await import("../lib/model-registry");
  reloadRegistry();
  return c.json({ success: true });
});

export default app;
