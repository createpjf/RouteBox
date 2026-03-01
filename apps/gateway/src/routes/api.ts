import { Hono } from "hono";
import { metrics } from "../lib/metrics";
import {
  PROVIDER_REGISTRY,
  MODEL_PRICING,
  pricingForModel,
  providers,
  getProviderKeyStatus,
  rebuildProviders,
} from "../lib/providers";
import {
  saveProviderKey,
  removeProviderKey,
  loadAllProviderKeys,
  loadProviderKey,
  updateProviderKeyValidation,
  loadRequestById,
  queryTimeSeries,
  queryProviderBreakdown,
  queryTopModels,
  queryTotals,
  queryMonthSpend,
  loadModelPreferences,
  saveModelPreference,
  removeModelPreference,
  saveSetting,
  loadSetting,
  loadAllModelToggles,
  saveModelToggle,
  loadRoutingRules,
  saveRoutingRule,
  updateRoutingRuleById,
  removeRoutingRule,
} from "../lib/db";
import { validateProviderKey } from "../lib/validate-key";
import { refreshPreferencesCache, refreshTogglesCache, refreshRoutingRulesCache } from "../lib/router";

const app = new Hono();

// ── Helper: load DB keys as Map ─────────────────────────────────────────────

function getDbKeysMap(): Map<string, string> {
  const rows = loadAllProviderKeys();
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.provider_name, r.api_key);
  return map;
}

// Provider health
app.get("/providers", (c) => {
  const stats = metrics.getStats();
  return c.json({ providers: stats.providers });
});

// ── Provider registry (key management) ──────────────────────────────────────

app.get("/providers/registry", (c) => {
  const dbKeys = getDbKeysMap();
  const keyStatus = getProviderKeyStatus(dbKeys);
  const registry = PROVIDER_REGISTRY.map((tmpl) => ({
    name: tmpl.name,
    format: tmpl.format,
    ...keyStatus[tmpl.name],
  }));
  return c.json({ providers: registry });
});

app.put("/providers/:name/key", async (c) => {
  const name = c.req.param("name");
  const tmpl = PROVIDER_REGISTRY.find((t) => t.name === name);
  if (!tmpl) return c.json({ error: "Unknown provider" }, 404);

  const body = await c.req.json<{ apiKey: string }>();
  if (!body.apiKey?.trim()) return c.json({ error: "API key required" }, 400);

  // Validate key
  const result = await validateProviderKey(tmpl, body.apiKey.trim());
  if (!result.ok) {
    return c.json({ error: result.error ?? "Key validation failed" }, 422);
  }

  // Save to DB
  saveProviderKey(name, body.apiKey.trim());
  updateProviderKeyValidation(name);

  // Rebuild providers + sync metrics
  rebuildProviders(getDbKeysMap());
  metrics.syncProviders();

  return c.json({ success: true, provider: name });
});

app.delete("/providers/:name/key", (c) => {
  const name = c.req.param("name");
  const tmpl = PROVIDER_REGISTRY.find((t) => t.name === name);
  if (!tmpl) return c.json({ error: "Unknown provider" }, 404);

  // Only delete DB keys — env keys can't be removed via API
  const row = loadProviderKey(name);
  if (!row) return c.json({ error: "No DB key to delete (env keys cannot be removed)" }, 400);

  removeProviderKey(name);

  // Rebuild providers + sync metrics
  rebuildProviders(getDbKeysMap());
  metrics.syncProviders();

  return c.json({ success: true, provider: name });
});

app.post("/providers/:name/validate", async (c) => {
  const name = c.req.param("name");
  const tmpl = PROVIDER_REGISTRY.find((t) => t.name === name);
  if (!tmpl) return c.json({ error: "Unknown provider" }, 404);

  // Find the active key (env or DB)
  const envKey = process.env[tmpl.envKey] ?? "";
  const dbRow = loadProviderKey(name);
  const apiKey = envKey || dbRow?.api_key;

  if (!apiKey) return c.json({ error: "No key configured" }, 400);

  const result = await validateProviderKey(tmpl, apiKey);
  if (result.ok && dbRow) {
    updateProviderKeyValidation(name);
  }

  return c.json({ valid: result.ok, error: result.error ?? null });
});

// Models — list available models grouped by active provider
app.get("/models", (c) => {
  const activeProviders = providers;
  const result: { provider: string; models: { id: string; pricing: { input: number; output: number } }[] }[] = [];

  for (const p of activeProviders) {
    const models = Object.keys(MODEL_PRICING)
      .filter((m) => p.prefixes.some((pfx) => m.startsWith(pfx)))
      .map((id) => ({ id, pricing: pricingForModel(id, p.name) }));
    result.push({ provider: p.name, models });
  }

  return c.json({ providers: result });
});

// Balance
app.get("/balance", (c) => {
  return c.json({
    current: metrics.balance,
    currency: "USD",
    lowThreshold: 5,
  });
});

// Gateway auth token info (used by client to display connection key)
app.get("/keys", (c) => {
  const token = process.env.ROUTEBOX_TOKEN ?? "";
  if (!token) {
    return c.json({ keys: [] });
  }
  const masked = token.length > 8
    ? token.slice(0, 6) + "..." + token.slice(-4)
    : "****";
  return c.json({
    keys: [
      {
        id: "key_gateway",
        name: "Gateway Token",
        prefix: token.slice(0, 6),
        maskedKey: masked,
        createdAt: new Date().toISOString(),
      },
    ],
  });
});

// Routing strategy
app.get("/routing", (c) => {
  return c.json({
    current: metrics.routingStrategy,
    strategies: [
      { id: "smart_auto", name: "Smart Auto", description: "AI picks the best route" },
      { id: "cost_first", name: "Cost First", description: "Minimize cost per token" },
      { id: "speed_first", name: "Speed First", description: "Minimize latency" },
      { id: "quality_first", name: "Quality First", description: "Use the best model available" },
    ],
  });
});

const VALID_STRATEGIES = new Set(["smart_auto", "cost_first", "speed_first", "quality_first"]);

app.put("/routing", async (c) => {
  const body = await c.req.json<{ strategy_id: string }>();
  if (!body.strategy_id || !VALID_STRATEGIES.has(body.strategy_id)) {
    return c.json({ error: `Invalid strategy_id. Must be one of: ${[...VALID_STRATEGIES].join(", ")}` }, 400);
  }
  metrics.setRoutingStrategy(body.strategy_id);
  return c.json({ success: true, current: body.strategy_id });
});

// Traffic pause/resume
app.post("/traffic/pause", (c) => {
  metrics.setTrafficPaused(true);
  return c.json({ paused: true });
});

app.post("/traffic/resume", (c) => {
  metrics.setTrafficPaused(false);
  return c.json({ paused: false });
});

app.get("/traffic/status", (c) => {
  return c.json({ paused: metrics.trafficPaused });
});

// ── Analytics ────────────────────────────────────────────────────────────────

app.get("/analytics", (c) => {
  const period = c.req.query("period") || "today";
  const now = Date.now();
  let sinceTs: number;
  let groupBy: "hour" | "day";

  switch (period) {
    case "7d":
      sinceTs = now - 7 * 86_400_000;
      groupBy = "day";
      break;
    case "30d":
      sinceTs = now - 30 * 86_400_000;
      groupBy = "day";
      break;
    default: // today
      sinceTs = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
      groupBy = "hour";
      break;
  }

  const rawSeries = queryTimeSeries(sinceTs, groupBy);
  const seriesMap = new Map(rawSeries.map((r) => [r.date, r]));

  // Build a complete time axis so the chart always has continuous data points
  const slots: string[] = [];
  if (groupBy === "hour") {
    // Today: 24 hourly slots (00:00 .. 23:00)
    const d = new Date(sinceTs);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    for (let h = 0; h < 24; h++) {
      slots.push(`${ymd} ${String(h).padStart(2, "0")}:00`);
    }
  } else {
    // 7d / 30d: daily slots
    const days = period === "30d" ? 30 : 7;
    for (let i = 0; i < days; i++) {
      const d = new Date(now - (days - 1 - i) * 86_400_000);
      slots.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
  }

  const timeSeries = slots.map((date) => {
    const r = seriesMap.get(date);
    return {
      date,
      cost: +(r?.total_cost ?? 0).toFixed(6),
      tokens: r?.total_tokens ?? 0,
      requests: r?.request_count ?? 0,
      inputTokens: r?.input_tokens ?? 0,
      outputTokens: r?.output_tokens ?? 0,
    };
  });

  const providerBreakdown = queryProviderBreakdown(sinceTs).map((r) => ({
    provider: r.provider,
    requests: r.requests,
    cost: +(r.cost ?? 0).toFixed(6),
    tokens: r.tokens ?? 0,
  }));

  const topModels = queryTopModels(sinceTs, 5).map((r) => ({
    model: r.model,
    requests: r.requests,
    cost: +(r.cost ?? 0).toFixed(6),
  }));

  const totals = queryTotals(sinceTs);

  return c.json({
    period,
    timeSeries,
    providerBreakdown,
    topModels,
    totals: {
      requests: totals.requests,
      tokens: totals.tokens ?? 0,
      cost: +(totals.cost ?? 0).toFixed(6),
      avgLatency: Math.round(totals.avg_latency ?? 0),
    },
  });
});

// ── Budget ───────────────────────────────────────────────────────────────────

app.get("/budget", (c) => {
  const monthly = parseFloat(loadSetting("budgetMonthly") ?? "0");
  const spent = queryMonthSpend();
  return c.json({ monthly, spent: +spent.toFixed(6), currency: "USD" });
});

app.put("/budget", async (c) => {
  const body = await c.req.json<{ monthly: number }>();
  const amount = Math.max(0, body.monthly ?? 0);
  saveSetting("budgetMonthly", String(amount));
  metrics.setBudget(amount);
  return c.json({ success: true, monthly: amount });
});

// ── Model Preferences ────────────────────────────────────────────────────────

app.get("/preferences", (c) => {
  const prefs = loadModelPreferences();
  return c.json({
    preferences: prefs.map((p) => ({
      id: p.id,
      modelPattern: p.model_pattern,
      provider: p.provider_name,
      action: p.action,
      priority: p.priority,
    })),
  });
});

app.post("/preferences", async (c) => {
  const body = await c.req.json<{ modelPattern: string; provider: string; action: string; priority?: number }>();
  if (!body.modelPattern?.trim() || !body.provider?.trim()) {
    return c.json({ error: "modelPattern and provider are required" }, 400);
  }
  const action = body.action === "exclude" ? "exclude" : "pin";
  const id = saveModelPreference(body.modelPattern.trim(), body.provider.trim(), action, body.priority ?? 0);
  refreshPreferencesCache();
  return c.json({ success: true, id });
});

app.delete("/preferences/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  removeModelPreference(id);
  refreshPreferencesCache();
  return c.json({ success: true });
});

// ── Model Toggles ──────────────────────────────────────────────────────────

app.get("/model-toggles", (c) => {
  const toggles = loadAllModelToggles();
  return c.json({
    toggles: toggles.map((t) => ({
      id: t.id,
      modelId: t.model_id,
      provider: t.provider_name,
      enabled: t.enabled === 1,
    })),
  });
});

app.put("/model-toggles", async (c) => {
  const body = await c.req.json<{ modelId: string; provider: string; enabled: boolean }>();
  if (!body.modelId?.trim() || !body.provider?.trim()) {
    return c.json({ error: "modelId and provider are required" }, 400);
  }
  if (typeof body.enabled !== "boolean") {
    return c.json({ error: "enabled must be a boolean" }, 400);
  }
  saveModelToggle(body.modelId.trim(), body.provider.trim(), body.enabled);
  refreshTogglesCache();
  return c.json({ success: true });
});

// ── Routing Rules ──────────────────────────────────────────────────────────

app.get("/routing-rules", (c) => {
  const rules = loadRoutingRules(true);
  return c.json({
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      matchType: r.match_type,
      matchValue: r.match_value,
      targetModel: r.target_model,
      targetProvider: r.target_provider,
      priority: r.priority,
      enabled: r.enabled === 1,
    })),
  });
});

app.post("/routing-rules", async (c) => {
  const body = await c.req.json<{
    name: string;
    matchType: string;
    matchValue: string;
    targetModel: string;
    targetProvider?: string;
    priority?: number;
    enabled?: boolean;
  }>();
  const validTypes = ["model_alias", "content_code", "content_long", "content_general"];
  if (!validTypes.includes(body.matchType)) {
    return c.json({ error: `matchType must be one of: ${validTypes.join(", ")}` }, 400);
  }
  if (!body.name?.trim() || !body.targetModel?.trim()) {
    return c.json({ error: "name and targetModel are required" }, 400);
  }
  if (body.matchType === "model_alias" && !body.matchValue?.trim()) {
    return c.json({ error: "matchValue is required for model_alias type" }, 400);
  }
  const id = saveRoutingRule(
    body.name.trim(),
    body.matchType,
    body.matchValue?.trim() || "{}",
    body.targetModel.trim(),
    body.targetProvider?.trim() || null,
    body.priority ?? 0,
    body.enabled ?? true,
  );
  refreshRoutingRulesCache();
  return c.json({ success: true, id });
});

app.put("/routing-rules/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  const body = await c.req.json<{
    name: string;
    matchType: string;
    matchValue: string;
    targetModel: string;
    targetProvider?: string;
    priority?: number;
    enabled?: boolean;
  }>();
  updateRoutingRuleById(
    id, body.name, body.matchType, body.matchValue || "{}",
    body.targetModel, body.targetProvider || null,
    body.priority ?? 0, body.enabled ?? true,
  );
  refreshRoutingRulesCache();
  return c.json({ success: true });
});

app.delete("/routing-rules/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  removeRoutingRule(id);
  refreshRoutingRulesCache();
  return c.json({ success: true });
});

// ── Request detail ──────────────────────────────────────────────────────────

app.get("/requests/:id", (c) => {
  const id = c.req.param("id");
  const record = loadRequestById(id);
  if (!record) return c.json({ error: "Request not found" }, 404);
  return c.json(record);
});

export default app;
