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
import { log } from "../lib/logger";
import type { CloudEnv } from "../types";

const app = new Hono<CloudEnv>();

// All admin routes require admin auth
app.use("/*", adminAuth);

/** Insert an admin audit log entry (fire-and-forget) */
function auditLog(
  adminEmail: string,
  action: string,
  targetUserId?: string,
  details?: Record<string, unknown>,
) {
  sql`
    INSERT INTO admin_audit_log (admin_email, action, target_user_id, details)
    VALUES (${adminEmail}, ${action}, ${targetUserId ?? null}, ${JSON.stringify(details ?? {})})
  `.catch((err) => {
    log.warn("audit_log_insert_failed", {
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

// ── GET /stats — overview dashboard numbers ────────────────────────────────

app.get("/stats", async (c) => {
  const stats = await getAdminStats();
  return c.json(stats);
});

// ── GET /users — user list with balance + usage count ──────────────────────

app.get("/users", async (c) => {
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "100", 10) || 100), 500);
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const search = c.req.query("search") ?? "";
  const { users, total } = await getAdminUsers(limit, offset, search);
  return c.json({ users, total, limit, offset });
});

// ── GET /transactions — recent transactions (all users) ────────────────────

app.get("/transactions", async (c) => {
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50), 200);
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const { transactions, total } = await getAdminTransactions(limit, offset);
  return c.json({ transactions, total, limit, offset });
});

// ── GET /usage/models — usage breakdown by model ───────────────────────────

app.get("/usage/models", async (c) => {
  const days = Math.min(Math.max(1, parseInt(c.req.query("days") ?? "7", 10) || 7), 90);
  const models = await getAdminUsageByModel(days);
  return c.json({ models, days });
});

// ── GET /usage/providers — usage breakdown by provider ─────────────────────

app.get("/usage/providers", async (c) => {
  const days = Math.min(Math.max(1, parseInt(c.req.query("days") ?? "7", 10) || 7), 90);
  const providers = await getAdminUsageByProvider(days);
  return c.json({ providers, days });
});

// ── GET /usage/trend — daily usage trend ───────────────────────────────────

app.get("/usage/trend", async (c) => {
  const days = Math.min(Math.max(1, parseInt(c.req.query("days") ?? "30", 10) || 30), 90);
  const trend = await getAdminDailyTrend(days);
  return c.json({ trend, days });
});

// ── GET /registrations/trend — daily registration trend ────────────────────

app.get("/registrations/trend", async (c) => {
  const days = Math.min(Math.max(1, parseInt(c.req.query("days") ?? "30", 10) || 30), 90);
  const trend = await getAdminRegistrationTrend(days);
  return c.json({ trend, days });
});

// ── GET /revenue/trend — daily revenue trend ───────────────────────────────

app.get("/revenue/trend", async (c) => {
  const days = Math.min(Math.max(1, parseInt(c.req.query("days") ?? "30", 10) || 30), 90);
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
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "20", 10) || 20), 100);
  const referrers = await getAdminTopReferrers(limit);
  return c.json({ referrers });
});

// ── GET /referrals/claims — recent referral claims ──────────────────────

app.get("/referrals/claims", async (c) => {
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50), 200);
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
    auditLog(c.get("email") as string, "update_user_plan", id, { plan: body.plan });
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
    auditLog(c.get("email") as string, "adjust_user_balance", id, {
      amountCents: body.amountCents,
      reason: body.reason,
      newBalance,
    });
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
  auditLog(c.get("email") as string, "create_provider_key", undefined, { providerName: body.providerName, label: body.label });
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
  auditLog(c.get("email") as string, "update_provider_key", undefined, { keyId: id });
  return c.json(key);
});

app.delete("/provider-keys/:id", async (c) => {
  const { deleteProviderKey, reloadProviders } = await import("../lib/provider-config");
  const id = c.req.param("id");
  await deleteProviderKey(id);
  await reloadProviders();
  auditLog(c.get("email") as string, "delete_provider_key", undefined, { keyId: id });
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
  auditLog(c.get("email") as string, "update_provider_access", undefined, {
    providerName,
    isEnabled: body.isEnabled,
    allowedPlans: body.allowedPlans,
  });
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

  const validStatuses = ["active", "beta", "deprecated", "disabled"];
  if (body.status && !validStatuses.includes(body.status as string)) {
    return c.json({ error: { message: "status must be active, beta, deprecated, or disabled", type: "validation_error" } }, 400);
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
    auditLog(c.get("email") as string, "create_model", undefined, { modelId: body.modelId });
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

  // Status validation
  const validStatuses = ["active", "beta", "deprecated", "disabled"];
  if (body.status && !validStatuses.includes(body.status as string)) {
    return c.json({ error: { message: "status must be active, beta, deprecated, or disabled", type: "validation_error" } }, 400);
  }

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
  auditLog(c.get("email") as string, "update_model", undefined, {
    modelId: model.modelId ?? id,
    ...(body.status ? { newStatus: body.status } : {}),
  });
  return c.json(model);
});

app.delete("/models/registry/:id", async (c) => {
  const { deleteModel, reloadRegistry } = await import("../lib/model-registry");
  const id = c.req.param("id");
  const deleted = await deleteModel(id);
  if (!deleted) return c.json({ error: { message: "Model not found", type: "not_found" } }, 404);
  reloadRegistry();
  auditLog(c.get("email") as string, "delete_model", undefined, { modelId: id });
  return c.json({ success: true });
});

app.post("/models/registry/reload", async (c) => {
  const { reloadRegistry } = await import("../lib/model-registry");
  reloadRegistry();
  return c.json({ success: true });
});

// POST /models/registry/:id/test — connectivity check
app.post("/models/registry/:id/test", async (c) => {
  const { getModel } = await import("../lib/model-registry");
  const { cloudProvidersForModel } = await import("../lib/key-pool");

  const id = c.req.param("id");
  const entry = await getModel(id);
  if (!entry) return c.json({ error: { message: "Model not found" } }, 404);

  const modelId = entry.modelId as string;
  const providers = cloudProvidersForModel(modelId);
  if (providers.length === 0) {
    return c.json({ ok: false, error: "No provider key configured for this model" });
  }

  const provider = providers[0];
  const start = Date.now();

  try {
    // Build request based on provider format
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    let url: string;
    let body: string;

    if (provider.format === "anthropic") {
      headers["x-api-key"] = provider.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      url = `${provider.baseUrl}/messages`;
      body = JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      });
    } else {
      if (provider.authHeader) {
        headers[provider.authHeader] = provider.apiKey;
      } else {
        headers["Authorization"] = `Bearer ${provider.apiKey}`;
      }
      url = `${provider.baseUrl}/chat/completions`;
      body = JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
        stream: false,
      });
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(5000),
    });

    const latencyMs = Date.now() - start;
    if (res.ok) {
      await res.text();
      return c.json({ ok: true, provider: provider.name, latencyMs });
    } else {
      const respBody = await res.text();
      let errorMsg = `${res.status} ${res.statusText}`;
      try { errorMsg = JSON.parse(respBody)?.error?.message || errorMsg; } catch {}
      return c.json({ ok: false, error: errorMsg, provider: provider.name, latencyMs });
    }
  } catch (e: any) {
    const latencyMs = Date.now() - start;
    return c.json({ ok: false, error: e.message || "Connection failed", provider: provider.name, latencyMs });
  }
});

// ── User Detail ─────────────────────────────────────────────────────────

app.get("/users/:id", async (c) => {
  const user = await getAdminUser(c.req.param("id"));
  if (!user) return c.json({ error: { message: "User not found", type: "not_found" } }, 404);
  return c.json(user);
});

app.get("/users/:id/transactions", async (c) => {
  const id = c.req.param("id");
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50), 200);
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const result = await getUserTransactions(id, limit, offset);
  return c.json({ ...result, limit, offset });
});

app.get("/users/:id/requests", async (c) => {
  const id = c.req.param("id");
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50), 200);
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const result = await getUserRequests(id, limit, offset);
  return c.json({ ...result, limit, offset });
});

app.get("/users/:id/models", async (c) => {
  const id = c.req.param("id");
  const days = Math.min(Math.max(1, parseInt(c.req.query("days") ?? "30", 10) || 30), 90);
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
    auditLog(c.get("email") as string, "create_package", undefined, { packageId: body.id, label: body.label });
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
    amountCents?: number;
    creditsCents?: number;
  }>();

  const setObj: Record<string, unknown> = {};
  if (body.polarProductId !== undefined) setObj.polar_product_id = body.polarProductId;
  if (body.label !== undefined) setObj.label = body.label;
  if ("bonus" in body) setObj.bonus = body.bonus;
  if (body.isActive !== undefined) setObj.is_active = body.isActive;
  if (body.sortOrder !== undefined) setObj.sort_order = body.sortOrder;
  if (body.amountCents !== undefined) setObj.amount_cents = body.amountCents;
  if (body.creditsCents !== undefined) setObj.credits_cents = body.creditsCents;

  if (Object.keys(setObj).length === 0) {
    return c.json({ error: { message: "No fields to update", type: "validation_error" } }, 400);
  }

  const [row] = await sql`
    UPDATE credit_packages SET ${sql(setObj)} WHERE id = ${id} RETURNING *
  `;
  if (!row) return c.json({ error: { message: "Package not found", type: "not_found" } }, 404);
  reloadCreditPackages();
  auditLog(c.get("email") as string, "update_package", undefined, { packageId: id });
  return c.json(row);
});

app.delete("/packages/:id", async (c) => {
  const { reloadCreditPackages } = await import("../lib/polar");
  const id = c.req.param("id");
  await sql`UPDATE credit_packages SET is_active = false WHERE id = ${id}`;
  reloadCreditPackages();
  auditLog(c.get("email") as string, "delete_package", undefined, { packageId: id });
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
  auditLog(c.get("email") as string, "create_announcement", undefined, { title: body.title });
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
  auditLog(c.get("email") as string, "update_announcement", undefined, { announcementId: id });
  return c.json(row);
});

app.delete("/announcements/:id", async (c) => {
  const id = c.req.param("id");
  const result = await sql`DELETE FROM announcements WHERE id = ${id}`;
  if (result.count === 0) return c.json({ error: { message: "Announcement not found", type: "not_found" } }, 404);
  auditLog(c.get("email") as string, "delete_announcement", undefined, { announcementId: id });
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
    RETURNING id, user_id
  `;
  if (!key) return c.json({ error: { message: "Key not found", type: "not_found" } }, 404);
  auditLog(c.get("email") as string, "revoke_api_key", key.user_id as string, { apiKeyId: id });
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
    auditLog(c.get("email") as string, "process_referral_earnings", undefined, { month });
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
  auditLog(c.get("email") as string, "update_model_pricing", undefined, { modelId: id });
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

// ── GET /plans/config — subscription plan Polar IDs ──────────────────────

app.get("/plans/config", async (c) => {
  const { SUBSCRIPTION_PLANS } = await import("../lib/polar");
  const plans = Object.values(SUBSCRIPTION_PLANS).map((p: any) => ({
    id: p.id,
    label: p.label,
    monthlyPrice: p.monthlyPrice,
    polarProductId: p.polarProductId || "",
    polarProductIdPromo: p.polarProductIdPromo || "",
  }));
  return c.json({ plans });
});

// ── PATCH /plans/config/:planId — update subscription plan Polar IDs ─────

app.patch("/plans/config/:planId", async (c) => {
  const { updatePlanPolarIds } = await import("../lib/polar");
  const planId = c.req.param("planId");
  const body = await c.req.json<{ polarProductId?: string; polarProductIdPromo?: string }>();
  if (body.polarProductId === undefined && body.polarProductIdPromo === undefined) {
    return c.json({ error: { message: "No fields to update", type: "validation_error" } }, 400);
  }
  const ok = updatePlanPolarIds(planId, body.polarProductId, body.polarProductIdPromo);
  if (!ok) return c.json({ error: { message: "Plan not found", type: "not_found" } }, 404);
  auditLog(c.get("email") as string, "update_plan_config", undefined, { planId });
  return c.json({ success: true });
});

// ── Routing Config ──────────────────────────────────────────────────

app.get("/routing/config", async (c) => {
  const { getGlobalStrategy, getUserOverrides } = await import("../lib/routing-config");
  const [defaultStrategy, userOverrides] = await Promise.all([
    getGlobalStrategy(),
    getUserOverrides(),
  ]);
  return c.json({ defaultStrategy, userOverrides });
});

app.patch("/routing/config", async (c) => {
  const { setGlobalStrategy, VALID_STRATEGIES } = await import("../lib/routing-config");
  const body = await c.req.json<{ defaultStrategy: string }>();
  if (!body.defaultStrategy || !VALID_STRATEGIES.includes(body.defaultStrategy as any)) {
    return c.json({
      error: { message: `strategy must be one of: ${VALID_STRATEGIES.join(", ")}`, type: "validation_error" },
    }, 400);
  }
  await setGlobalStrategy(body.defaultStrategy);
  auditLog(c.get("email") as string, "update_routing_strategy", undefined, { strategy: body.defaultStrategy });
  return c.json({ success: true });
});

app.post("/routing/user-override", async (c) => {
  const { setUserOverride, VALID_STRATEGIES } = await import("../lib/routing-config");
  const body = await c.req.json<{ userId: string; strategy: string }>();
  if (!body.userId || !body.strategy) {
    return c.json({ error: { message: "userId and strategy are required", type: "validation_error" } }, 400);
  }
  if (!VALID_STRATEGIES.includes(body.strategy as any)) {
    return c.json({
      error: { message: `strategy must be one of: ${VALID_STRATEGIES.join(", ")}`, type: "validation_error" },
    }, 400);
  }
  // Verify user exists
  const [user] = await sql`SELECT id FROM users WHERE id = ${body.userId}`;
  if (!user) {
    // Try by email
    const [byEmail] = await sql`SELECT id FROM users WHERE email = ${body.userId}`;
    if (!byEmail) {
      return c.json({ error: { message: "User not found", type: "not_found" } }, 404);
    }
    await setUserOverride(byEmail.id as string, body.strategy);
    auditLog(c.get("email") as string, "set_user_routing_override", byEmail.id as string, { strategy: body.strategy });
    return c.json({ success: true, userId: byEmail.id });
  }
  await setUserOverride(body.userId, body.strategy);
  auditLog(c.get("email") as string, "set_user_routing_override", body.userId, { strategy: body.strategy });
  return c.json({ success: true });
});

app.delete("/routing/user-override/:userId", async (c) => {
  const { removeUserOverride } = await import("../lib/routing-config");
  const userId = c.req.param("userId");
  await removeUserOverride(userId);
  auditLog(c.get("email") as string, "remove_user_routing_override", userId);
  return c.json({ success: true });
});

// ── GET /audit-log — paginated admin audit log with filters ─────────────

app.get("/audit-log", async (c) => {
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50), 200);
  const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  const action = c.req.query("action") ?? "";
  const adminEmail = c.req.query("admin_email") ?? "";
  const dateFrom = c.req.query("date_from") ?? "";
  const dateTo = c.req.query("date_to") ?? "";

  const conditions: string[] = [];
  const params: (string | number | boolean | null)[] = [];

  if (action) {
    params.push(action);
    conditions.push(`action = $${params.length}`);
  }
  if (adminEmail) {
    params.push(`%${adminEmail}%`);
    conditions.push(`admin_email ILIKE $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`created_at >= $${params.length}::timestamptz`);
  }
  if (dateTo) {
    params.push(dateTo + "T23:59:59Z");
    conditions.push(`created_at <= $${params.length}::timestamptz`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [countRow] = await sql.unsafe(
    `SELECT COUNT(*)::int AS total FROM admin_audit_log ${where}`,
    params,
  );
  const rows = await sql.unsafe(
    `SELECT id, admin_email, action, target_user_id, details, created_at
     FROM admin_audit_log ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return c.json({
    entries: rows.map((r) => ({
      id: r.id,
      adminEmail: r.admin_email,
      action: r.action,
      targetUserId: r.target_user_id,
      details: typeof r.details === "string" ? (() => { try { return JSON.parse(r.details as string); } catch { return r.details; } })() : r.details,
      createdAt: r.created_at,
    })),
    total: countRow.total,
    limit,
    offset,
  });
});

// ── User Suspend / Ban ───────────────────────────────────────────────────

app.post("/users/:id/suspend", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ reason: string }>();
  if (!body.reason || typeof body.reason !== "string") {
    return c.json({ error: { message: "reason is required", type: "validation_error" } }, 400);
  }
  if (body.reason.length > 500) {
    return c.json({ error: { message: "Reason too long (max 500 chars)", type: "validation_error" } }, 400);
  }
  const [user] = await sql`
    UPDATE users SET status = 'suspended', suspended_reason = ${body.reason}, suspended_at = now()
    WHERE id = ${id} AND status = 'active'
    RETURNING id
  `;
  if (!user) return c.json({ error: { message: "User not found or already suspended/banned", type: "not_found" } }, 404);
  auditLog(c.get("email") as string, "suspend_user", id, { reason: body.reason });
  return c.json({ success: true });
});

app.post("/users/:id/unsuspend", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }));
  const [user] = await sql`
    UPDATE users SET status = 'active', suspended_reason = NULL, suspended_at = NULL
    WHERE id = ${id} AND status = 'suspended'
    RETURNING id
  `;
  if (!user) return c.json({ error: { message: "User not found or already active", type: "not_found" } }, 404);
  auditLog(c.get("email") as string, "unsuspend_user", id, { reason: body.reason });
  return c.json({ success: true });
});

app.post("/users/:id/ban", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ reason: string }>();
  if (!body.reason || typeof body.reason !== "string") {
    return c.json({ error: { message: "reason is required", type: "validation_error" } }, 400);
  }
  if (body.reason.length > 500) {
    return c.json({ error: { message: "Reason too long (max 500 chars)", type: "validation_error" } }, 400);
  }
  const [user] = await sql`
    UPDATE users SET status = 'banned', suspended_reason = ${body.reason}, suspended_at = now()
    WHERE id = ${id} AND status != 'banned'
    RETURNING id
  `;
  if (!user) return c.json({ error: { message: "User not found or already banned", type: "not_found" } }, 404);
  // Revoke all API keys
  try {
    await sql`UPDATE api_keys SET is_active = false WHERE user_id = ${id}`;
  } catch (err) {
    log.warn("api_key_revocation_failed", {
      userId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  auditLog(c.get("email") as string, "ban_user", id, { reason: body.reason });
  return c.json({ success: true });
});

// ── Provider Health Monitoring ───────────────────────────────────────────

app.get("/providers/health", async (c) => {
  const { getAllBreakerStates } = await import("../lib/circuit-breaker");
  const breakers = getAllBreakerStates();

  // DB stats for last 1 hour
  const dbStats = await sql`
    SELECT provider,
      COUNT(*)::int AS total,
      COUNT(CASE WHEN status = 'ok' THEN 1 END)::int AS success_count,
      AVG(latency_ms)::int AS avg_latency,
      PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::int AS p99_latency
    FROM requests
    WHERE created_at > now() - interval '1 hour'
    GROUP BY provider
  `;

  const dbMap = new Map(dbStats.map((r) => [r.provider, r]));

  return c.json({
    breakers: breakers.map((b) => {
      const providerName = b.id.replace(/:.*$/, "");
      const db = dbMap.get(providerName);
      return {
        ...b,
        providerName,
        db: db
          ? {
              total: db.total,
              successCount: db.success_count,
              successRate: db.total > 0 ? Number((db.success_count / db.total).toFixed(3)) : 1,
              avgLatency: db.avg_latency,
              p99Latency: db.p99_latency,
            }
          : null,
      };
    }),
  });
});

// ── CSV Export ────────────────────────────────────────────────────────────

function csvRow(values: unknown[]): string {
  return values.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
}

app.get("/export/users", async (c) => {
  const { users } = await getAdminUsers(50000, 0, "");
  const header = "Email,Plan,Status,Balance (cents),Deposited (cents),Used (cents),Requests,Joined\n";
  const rows = users
    .map((u) =>
      csvRow([u.email, u.plan, u.status, u.balanceCents, u.totalDepositedCents, u.totalUsedCents, u.requestCount, u.createdAt]),
    )
    .join("\n");
  return c.text(header + rows, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="users-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
});

app.get("/export/transactions", async (c) => {
  const days = Math.min(Math.max(1, parseInt(c.req.query("days") ?? "30", 10) || 30), 365);
  const rows = await sql`
    SELECT t.created_at, u.email, t.type, t.amount_cents, t.balance_after_cents, t.description
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    WHERE t.created_at > now() - make_interval(days => ${days})
    ORDER BY t.created_at DESC
    LIMIT 50000
  `;
  const header = "Date,Email,Type,Amount (cents),Balance After (cents),Description\n";
  const csv = rows
    .map((r) => csvRow([r.created_at, r.email, r.type, r.amount_cents, r.balance_after_cents, r.description]))
    .join("\n");
  return c.text(header + csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="transactions-${days}d-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
});

app.get("/export/usage", async (c) => {
  const days = Math.min(Math.max(1, parseInt(c.req.query("days") ?? "30", 10) || 30), 365);
  const rows = await sql`
    SELECT created_at::date AS date, model, provider,
      COUNT(*)::int AS requests,
      SUM(input_tokens)::int AS tokens_in,
      SUM(output_tokens)::int AS tokens_out,
      SUM(cost_cents)::int AS cost_cents
    FROM requests
    WHERE created_at > now() - make_interval(days => ${days})
    GROUP BY created_at::date, model, provider
    ORDER BY date DESC, requests DESC
  `;
  const header = "Date,Model,Provider,Requests,Tokens In,Tokens Out,Cost (cents)\n";
  const csv = rows
    .map((r) => csvRow([r.date, r.model, r.provider, r.requests, r.tokens_in, r.tokens_out, r.cost_cents]))
    .join("\n");
  return c.text(header + csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="usage-${days}d-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
});

export default app;
