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
  getAdminUser,
  getUserTransactions,
  getUserRequests,
  getUserModelBreakdown,
} from "../lib/admin-queries";
import { sql } from "../lib/db-cloud";
import { processMonthlyReferralEarnings } from "../lib/referrals";
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
  const validPlans = ["starter", "pro", "max"];
  if (!validPlans.includes(body.plan)) {
    return c.json({ error: { message: "plan must be 'starter', 'pro', or 'max'", type: "validation_error" } }, 400);
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
  if (typeof body.amountCents !== "number" || !Number.isInteger(body.amountCents) || body.amountCents === 0) {
    return c.json({ error: { message: "amountCents must be a non-zero integer", type: "validation_error" } }, 400);
  }
  if (Math.abs(body.amountCents) > 10_000_000) {
    return c.json({ error: { message: "amountCents exceeds maximum allowed adjustment ($100,000)", type: "validation_error" } }, 400);
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
  const validPlans = ["all", "starter", "pro", "max"];
  if (!Array.isArray(body.allowedPlans) || !body.allowedPlans.every((p: string) => validPlans.includes(p))) {
    return c.json({ error: { message: "allowedPlans must be array of 'all', 'starter', 'pro', 'max'", type: "validation_error" } }, 400);
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

// ── User Detail ─────────────────────────────────────────────────────────

app.get("/users/:id", async (c) => {
  const user = await getAdminUser(c.req.param("id"));
  if (!user) return c.json({ error: { message: "User not found", type: "not_found" } }, 404);
  return c.json(user);
});

app.get("/users/:id/transactions", async (c) => {
  const id = c.req.param("id");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);
  const result = await getUserTransactions(id, limit, offset);
  return c.json({ ...result, limit, offset });
});

app.get("/users/:id/requests", async (c) => {
  const id = c.req.param("id");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);
  const result = await getUserRequests(id, limit, offset);
  return c.json({ ...result, limit, offset });
});

app.get("/users/:id/models", async (c) => {
  const id = c.req.param("id");
  const days = Math.min(Number(c.req.query("days") ?? 30), 90);
  const models = await getUserModelBreakdown(id, days);
  return c.json({ models, days });
});

// ── Credit Packages CRUD ─────────────────────────────────────────────────

app.get("/packages", async (c) => {
  const rows = await sql`SELECT * FROM credit_packages ORDER BY sort_order, id`;
  return c.json({
    packages: rows.map((r) => ({
      id: r.id,
      polarProductId: r.polar_product_id,
      amountCents: r.amount_cents,
      creditsCents: r.credits_cents,
      label: r.label,
      bonus: r.bonus,
      isActive: r.is_active,
      sortOrder: r.sort_order,
      createdAt: r.created_at,
    })),
  });
});

app.post("/packages", async (c) => {
  const { reloadCreditPackages } = await import("../lib/polar");
  const body = await c.req.json<{
    id: string;
    polarProductId: string;
    amountCents: number;
    creditsCents: number;
    label: string;
    bonus?: string;
    sortOrder?: number;
  }>();

  if (!body.id || !body.label || !body.amountCents || !body.creditsCents) {
    return c.json({ error: { message: "id, label, amountCents, creditsCents are required", type: "validation_error" } }, 400);
  }

  try {
    const [row] = await sql`
      INSERT INTO credit_packages (id, polar_product_id, amount_cents, credits_cents, label, bonus, sort_order)
      VALUES (
        ${body.id},
        ${body.polarProductId ?? ""},
        ${body.amountCents},
        ${body.creditsCents},
        ${body.label},
        ${body.bonus ?? null},
        ${body.sortOrder ?? 0}
      )
      RETURNING *
    `;
    reloadCreditPackages();
    return c.json(row, 201);
  } catch (err: any) {
    if (err.message?.includes("duplicate key") || err.message?.includes("unique")) {
      return c.json({ error: { message: "A package with this ID already exists", type: "conflict" } }, 409);
    }
    throw err;
  }
});

app.patch("/packages/:id", async (c) => {
  const { reloadCreditPackages } = await import("../lib/polar");
  const id = c.req.param("id");
  const body = await c.req.json<{
    polarProductId?: string;
    label?: string;
    bonus?: string | null;
    isActive?: boolean;
    sortOrder?: number;
  }>();

  const setObj: Record<string, unknown> = {};
  if (body.polarProductId !== undefined) setObj.polar_product_id = body.polarProductId;
  if (body.label !== undefined) setObj.label = body.label;
  if ("bonus" in body) setObj.bonus = body.bonus;
  if (body.isActive !== undefined) setObj.is_active = body.isActive;
  if (body.sortOrder !== undefined) setObj.sort_order = body.sortOrder;

  if (Object.keys(setObj).length === 0) {
    return c.json({ error: { message: "No fields to update", type: "validation_error" } }, 400);
  }

  const [row] = await sql`
    UPDATE credit_packages SET ${sql(setObj)} WHERE id = ${id} RETURNING *
  `;
  if (!row) return c.json({ error: { message: "Package not found", type: "not_found" } }, 404);
  reloadCreditPackages();
  return c.json(row);
});

app.delete("/packages/:id", async (c) => {
  const { reloadCreditPackages } = await import("../lib/polar");
  const id = c.req.param("id");
  await sql`UPDATE credit_packages SET is_active = false WHERE id = ${id}`;
  reloadCreditPackages();
  return c.json({ success: true });
});

// ── Announcements CRUD ───────────────────────────────────────────────────

app.get("/announcements", async (c) => {
  const rows = await sql`SELECT * FROM announcements ORDER BY created_at DESC`;
  return c.json({ announcements: rows });
});

app.post("/announcements", async (c) => {
  const body = await c.req.json<{
    title: string;
    message: string;
    type?: string;
    startsAt?: string;
    endsAt?: string;
  }>();

  if (!body.title || !body.message) {
    return c.json({ error: { message: "title and message are required", type: "validation_error" } }, 400);
  }
  const validTypes = ["info", "warning", "error"];
  if (body.type && !validTypes.includes(body.type)) {
    return c.json({ error: { message: "type must be info, warning, or error", type: "validation_error" } }, 400);
  }
  if (body.startsAt && body.endsAt) {
    const start = new Date(body.startsAt);
    const end = new Date(body.endsAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return c.json({ error: { message: "startsAt and endsAt must be valid dates", type: "validation_error" } }, 400);
    }
    if (end <= start) {
      return c.json({ error: { message: "endsAt must be after startsAt", type: "validation_error" } }, 400);
    }
  }
  if (body.endsAt && !body.startsAt && new Date(body.endsAt) <= new Date()) {
    return c.json({ error: { message: "endsAt cannot be in the past", type: "validation_error" } }, 400);
  }

  const [row] = await sql`
    INSERT INTO announcements (title, message, type, starts_at, ends_at)
    VALUES (
      ${body.title},
      ${body.message},
      ${body.type ?? "info"},
      ${body.startsAt ? new Date(body.startsAt) : sql`now()`},
      ${body.endsAt ? new Date(body.endsAt) : null}
    )
    RETURNING *
  `;
  return c.json(row, 201);
});

app.patch("/announcements/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    title?: string;
    message?: string;
    type?: string;
    isActive?: boolean;
    startsAt?: string;
    endsAt?: string | null;
  }>();

  const setObj: Record<string, unknown> = {};
  if (body.title !== undefined) setObj.title = body.title;
  if (body.message !== undefined) setObj.message = body.message;
  if (body.type !== undefined) setObj.type = body.type;
  if (body.isActive !== undefined) setObj.is_active = body.isActive;
  if (body.startsAt !== undefined) setObj.starts_at = new Date(body.startsAt);
  if ("endsAt" in body) setObj.ends_at = body.endsAt ? new Date(body.endsAt) : null;

  if (Object.keys(setObj).length === 0) {
    return c.json({ error: { message: "No fields to update", type: "validation_error" } }, 400);
  }

  const [row] = await sql`
    UPDATE announcements SET ${sql(setObj)} WHERE id = ${id} RETURNING *
  `;
  if (!row) return c.json({ error: { message: "Announcement not found", type: "not_found" } }, 404);
  return c.json(row);
});

app.delete("/announcements/:id", async (c) => {
  const result = await sql`DELETE FROM announcements WHERE id = ${c.req.param("id")}`;
  if (result.count === 0) return c.json({ error: { message: "Announcement not found", type: "not_found" } }, 404);
  return c.json({ success: true });
});

// ── Admin API Key Management ──────────────────────────────────────────────

app.get("/users/:id/api-keys", async (c) => {
  const userId = c.req.param("id");
  const rows = await sql`
    SELECT id, name, key_prefix, last_used_at, is_active, created_at
    FROM api_keys
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
  return c.json({
    apiKeys: rows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.key_prefix,
      lastUsedAt: r.last_used_at,
      isActive: r.is_active,
      createdAt: r.created_at,
    })),
  });
});

app.delete("/api-keys/:id", async (c) => {
  const id = c.req.param("id");
  const [key] = await sql`
    UPDATE api_keys SET is_active = false
    WHERE id = ${id}
    RETURNING id
  `;
  if (!key) return c.json({ error: { message: "Key not found", type: "not_found" } }, 404);
  return c.json({ success: true });
});

// ── GET /revenue/margin — per-model gross margin analysis ─────────────────

app.get("/revenue/margin", async (c) => {
  const rows = await sql`
    SELECT
      model_id,
      display_name,
      provider,
      user_price_input,
      user_price_output,
      purchase_price_input,
      purchase_price_output,
      profit_bonus,
      CASE
        WHEN purchase_price_input IS NOT NULL AND user_price_input IS NOT NULL
          AND user_price_input > 0
        THEN ROUND(((user_price_input - purchase_price_input) / user_price_input * 100)::numeric, 1)
        ELSE NULL
      END AS margin_input_pct,
      CASE
        WHEN purchase_price_output IS NOT NULL AND user_price_output IS NOT NULL
          AND user_price_output > 0
        THEN ROUND(((user_price_output - purchase_price_output) / user_price_output * 100)::numeric, 1)
        ELSE NULL
      END AS margin_output_pct
    FROM model_registry
    WHERE status != 'deprecated'
    ORDER BY margin_input_pct DESC NULLS LAST, model_id
  `;
  return c.json({ models: rows });
});

// ── GET /quota/usage — Starter daily quota usage overview ────────────────

app.get("/quota/usage", async (c) => {
  const date = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
  const rows = await sql`
    SELECT dqu.user_id, u.email, dqu.model_id, dqu.used_count, dqu.quota_date
    FROM daily_quota_usage dqu
    JOIN users u ON u.id = dqu.user_id
    WHERE dqu.quota_date = ${date}
    ORDER BY dqu.used_count DESC
    LIMIT 200
  `;
  return c.json({ date, usage: rows });
});

// ── POST /referrals/process — trigger monthly referral earnings settlement ─

app.post("/referrals/process", async (c) => {
  const rawBody = await c.req.json<{ month?: string }>().catch(() => ({ month: undefined }));
  const month = (rawBody as { month?: string }).month ?? new Date().toISOString().slice(0, 7);
  try {
    const result = await processMonthlyReferralEarnings(month);
    return c.json({ success: true, month, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: { message: msg, type: "server_error" } }, 500);
  }
});

// ── GET /models/registry/:id/pricing — model pricing detail ─────────────

app.get("/models/registry/:id/pricing", async (c) => {
  const [row] = await sql`
    SELECT model_id, display_name, provider,
           user_price_input, user_price_output,
           purchase_price_input, purchase_price_output,
           profit_bonus, price_input, price_output
    FROM model_registry WHERE id = ${c.req.param("id")}
  `;
  if (!row) return c.json({ error: { message: "Model not found", type: "not_found" } }, 404);
  return c.json(row);
});

// ── PATCH /models/registry/:id/pricing — update model user/purchase pricing ─

app.patch("/models/registry/:id/pricing", async (c) => {
  const { reloadRegistry } = await import("../lib/model-registry");
  const id = c.req.param("id");
  const body = await c.req.json<{
    userPriceInput?: number;
    userPriceOutput?: number;
    purchasePriceInput?: number;
    purchasePriceOutput?: number;
    profitBonus?: number;
  }>();

  const setObj: Record<string, unknown> = {};
  if (body.userPriceInput !== undefined) setObj.user_price_input = body.userPriceInput;
  if (body.userPriceOutput !== undefined) setObj.user_price_output = body.userPriceOutput;
  if (body.purchasePriceInput !== undefined) setObj.purchase_price_input = body.purchasePriceInput;
  if (body.purchasePriceOutput !== undefined) setObj.purchase_price_output = body.purchasePriceOutput;
  if (body.profitBonus !== undefined) setObj.profit_bonus = body.profitBonus;

  if (Object.keys(setObj).length === 0) {
    return c.json({ error: { message: "No pricing fields to update", type: "validation_error" } }, 400);
  }

  setObj.updated_at = sql`now()`;
  const [row] = await sql`
    UPDATE model_registry SET ${sql(setObj)} WHERE id = ${id} RETURNING *
  `;
  if (!row) return c.json({ error: { message: "Model not found", type: "not_found" } }, 404);
  reloadRegistry();
  return c.json({ success: true, model: row });
});

// ── GET /plans/stats — user count + revenue by plan ──────────────────────

app.get("/plans/stats", async (c) => {
  const rows = await sql`
    SELECT
      u.plan,
      COUNT(*)::int AS user_count,
      COALESCE(SUM(c.total_used_cents), 0)::int AS total_api_spend_cents,
      COALESCE(SUM(c.total_deposited_cents), 0)::int AS total_deposited_cents
    FROM users u
    LEFT JOIN credits c ON c.user_id = u.id
    GROUP BY u.plan
    ORDER BY u.plan
  `;
  return c.json({ plans: rows });
});

export default app;
