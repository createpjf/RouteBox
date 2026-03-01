// ---------------------------------------------------------------------------
// SQLite persistence — bun:sqlite for request history, aggregates, settings
// ---------------------------------------------------------------------------

import { Database } from "bun:sqlite";
import type { RequestRecord } from "./metrics";

const DB_PATH = process.env.ROUTEBOX_DB_PATH || "routebox.db";

const db = new Database(DB_PATH, { create: true });

// WAL mode for better concurrent read/write performance
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA synchronous = NORMAL");

// ── Schema ──────────────────────────────────────────────────────────────────

db.run(`
  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'success'
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS aggregates (
    key TEXT PRIMARY KEY,
    value REAL NOT NULL DEFAULT 0
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS provider_keys (
    provider_name TEXT PRIMARY KEY,
    api_key TEXT NOT NULL,
    validated_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer) * 1000)
  )
`);

// Index for time-range queries
db.run(`
  CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp)
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_requests_provider ON requests(provider)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_requests_model ON requests(model)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_requests_ts_provider ON requests(timestamp, provider)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_requests_ts_model ON requests(timestamp, model)`);

// ── Migrations (defensive) ──────────────────────────────────────────────────

function addColumnSafe(table: string, col: string, def: string) {
  try { db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); }
  catch { /* column already exists */ }
}

addColumnSafe("requests", "requested_model", "TEXT NOT NULL DEFAULT ''");
addColumnSafe("requests", "is_fallback", "INTEGER NOT NULL DEFAULT 0");
addColumnSafe("requests", "routing_strategy", "TEXT NOT NULL DEFAULT 'smart_auto'");

// ── Prepared statements ─────────────────────────────────────────────────────

const insertRequest = db.prepare(`
  INSERT OR IGNORE INTO requests (id, timestamp, provider, model, input_tokens, output_tokens, total_tokens, cost, latency_ms, status, requested_model, is_fallback, routing_strategy)
  VALUES ($id, $timestamp, $provider, $model, $inputTokens, $outputTokens, $totalTokens, $cost, $latencyMs, $status, $requestedModel, $isFallback, $routingStrategy)
`);

const getRecentRequests = db.prepare(`
  SELECT * FROM requests ORDER BY timestamp DESC LIMIT ?
`);

const getAggregate = db.prepare(`
  SELECT value FROM aggregates WHERE key = ?
`);

const upsertAggregate = db.prepare(`
  INSERT INTO aggregates (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

const getSetting = db.prepare(`
  SELECT value FROM settings WHERE key = ?
`);

const upsertSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

const countTodayByProvider = db.prepare(`
  SELECT provider, COUNT(*) as cnt FROM requests
  WHERE timestamp >= ? GROUP BY provider
`);

const pruneOld = db.prepare(`
  DELETE FROM requests WHERE timestamp < ?
`);

// ── Provider keys ───────────────────────────────────────────────────────────

const upsertProviderKey = db.prepare(`
  INSERT INTO provider_keys (provider_name, api_key, created_at, updated_at)
  VALUES ($name, $key, $now, $now)
  ON CONFLICT(provider_name) DO UPDATE SET api_key = excluded.api_key, updated_at = excluded.updated_at
`);

const deleteProviderKeyStmt = db.prepare(`
  DELETE FROM provider_keys WHERE provider_name = ?
`);

const getProviderKeyStmt = db.prepare(`
  SELECT * FROM provider_keys WHERE provider_name = ?
`);

const getAllProviderKeysStmt = db.prepare(`
  SELECT * FROM provider_keys
`);

const updateProviderKeyValidationStmt = db.prepare(`
  UPDATE provider_keys SET validated_at = ? WHERE provider_name = ?
`);

// ── Request by ID ───────────────────────────────────────────────────────────

const getRequestByIdStmt = db.prepare(`
  SELECT * FROM requests WHERE id = ?
`);

// ── Public API ──────────────────────────────────────────────────────────────

export function persistRequest(rec: RequestRecord) {
  insertRequest.run({
    $id: rec.id,
    $timestamp: rec.timestamp,
    $provider: rec.provider,
    $model: rec.model,
    $inputTokens: rec.inputTokens,
    $outputTokens: rec.outputTokens,
    $totalTokens: rec.totalTokens,
    $cost: rec.cost,
    $latencyMs: rec.latencyMs,
    $status: rec.status,
    $requestedModel: rec.requestedModel ?? "",
    $isFallback: rec.isFallback ? 1 : 0,
    $routingStrategy: rec.routingStrategy ?? "smart_auto",
  });
}

interface RequestRow {
  id: string;
  timestamp: number;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number;
  latency_ms: number;
  status: string;
  requested_model?: string;
  is_fallback?: number;
  routing_strategy?: string;
}

function rowToRecord(r: RequestRow): RequestRecord {
  return {
    id: r.id,
    timestamp: r.timestamp,
    provider: r.provider,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    totalTokens: r.total_tokens,
    cost: r.cost,
    latencyMs: r.latency_ms,
    status: r.status as RequestRecord["status"],
    requestedModel: r.requested_model || r.model,
    isFallback: !!(r.is_fallback),
    routingStrategy: r.routing_strategy || "smart_auto",
  };
}

export function loadRecentRequests(limit = 200): RequestRecord[] {
  const rows = getRecentRequests.all(limit) as RequestRow[];
  // Reverse to chronological order (oldest first)
  return rows.reverse().map(rowToRecord);
}

export function loadAggregate(key: string): number {
  const row = getAggregate.get(key) as { value: number } | null;
  return row?.value ?? 0;
}

export function saveAggregate(key: string, value: number) {
  upsertAggregate.run(key, value);
}

export function loadSetting(key: string): string | null {
  const row = getSetting.get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function saveSetting(key: string, value: string) {
  upsertSetting.run(key, value);
}

export function loadTodayRequestsByProvider(): Map<string, number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const rows = countTodayByProvider.all(startOfDay.getTime()) as { provider: string; cnt: number }[];
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.provider, r.cnt);
  return map;
}

/** Remove requests older than `days` days */
export function pruneOldRequests(days = 30) {
  const cutoff = Date.now() - days * 86_400_000;
  pruneOld.run(cutoff);
}

// ── Provider Key CRUD ───────────────────────────────────────────────────────

export interface ProviderKeyRow {
  provider_name: string;
  api_key: string;
  validated_at: number | null;
  created_at: number;
  updated_at: number;
}

export function saveProviderKey(name: string, apiKey: string) {
  upsertProviderKey.run({ $name: name, $key: apiKey, $now: Date.now() });
}

export function removeProviderKey(name: string) {
  deleteProviderKeyStmt.run(name);
}

export function loadProviderKey(name: string): ProviderKeyRow | null {
  return (getProviderKeyStmt.get(name) as ProviderKeyRow | null) ?? null;
}

export function loadAllProviderKeys(): ProviderKeyRow[] {
  return getAllProviderKeysStmt.all() as ProviderKeyRow[];
}

export function updateProviderKeyValidation(name: string) {
  updateProviderKeyValidationStmt.run(Date.now(), name);
}

// ── Request by ID ───────────────────────────────────────────────────────────

export function loadRequestById(id: string): RequestRecord | null {
  const row = getRequestByIdStmt.get(id) as RequestRow | null;
  return row ? rowToRecord(row) : null;
}

// ── Analytics queries ────────────────────────────────────────────────────────

export interface TimeSeriesRow {
  date: string;
  total_cost: number;
  total_tokens: number;
  request_count: number;
  input_tokens: number;
  output_tokens: number;
}

export interface ProviderBreakdownRow {
  provider: string;
  requests: number;
  cost: number;
  tokens: number;
}

export interface TopModelRow {
  model: string;
  requests: number;
  cost: number;
}

export interface TotalsRow {
  requests: number;
  tokens: number;
  cost: number;
  avg_latency: number;
}

const timeSeriesByDay = db.prepare(`
  SELECT strftime('%Y-%m-%d', timestamp/1000, 'unixepoch') as date,
         SUM(cost) as total_cost, SUM(total_tokens) as total_tokens,
         SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
         COUNT(*) as request_count
  FROM requests WHERE timestamp >= ?
  GROUP BY date ORDER BY date
`);

const timeSeriesByHour = db.prepare(`
  SELECT strftime('%Y-%m-%d %H:00', timestamp/1000, 'unixepoch') as date,
         SUM(cost) as total_cost, SUM(total_tokens) as total_tokens,
         SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
         COUNT(*) as request_count
  FROM requests WHERE timestamp >= ?
  GROUP BY date ORDER BY date
`);

const providerBreakdownStmt = db.prepare(`
  SELECT provider, COUNT(*) as requests, SUM(cost) as cost, SUM(total_tokens) as tokens
  FROM requests WHERE timestamp >= ?
  GROUP BY provider ORDER BY requests DESC
`);

const topModelsStmt = db.prepare(`
  SELECT model, COUNT(*) as requests, SUM(cost) as cost
  FROM requests WHERE timestamp >= ?
  GROUP BY model ORDER BY requests DESC LIMIT ?
`);

const totalsStmt = db.prepare(`
  SELECT COUNT(*) as requests, SUM(total_tokens) as tokens,
         SUM(cost) as cost, AVG(latency_ms) as avg_latency
  FROM requests WHERE timestamp >= ?
`);

const monthSpendStmt = db.prepare(`
  SELECT COALESCE(SUM(cost), 0) as total FROM requests WHERE timestamp >= ?
`);

export function queryTimeSeries(sinceTs: number, groupBy: "hour" | "day"): TimeSeriesRow[] {
  const stmt = groupBy === "hour" ? timeSeriesByHour : timeSeriesByDay;
  return stmt.all(sinceTs) as TimeSeriesRow[];
}

export function queryProviderBreakdown(sinceTs: number): ProviderBreakdownRow[] {
  return providerBreakdownStmt.all(sinceTs) as ProviderBreakdownRow[];
}

export function queryTopModels(sinceTs: number, limit = 5): TopModelRow[] {
  return topModelsStmt.all(sinceTs, limit) as TopModelRow[];
}

export function queryTotals(sinceTs: number): TotalsRow {
  const row = totalsStmt.get(sinceTs) as TotalsRow | null;
  return row ?? { requests: 0, tokens: 0, cost: 0, avg_latency: 0 };
}

export function queryMonthSpend(): number {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const row = monthSpendStmt.get(startOfMonth) as { total: number } | null;
  return row?.total ?? 0;
}

// ── Model preferences ───────────────────────────────────────────────────────

db.run(`
  CREATE TABLE IF NOT EXISTS model_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_pattern TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'pin',
    priority INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer) * 1000)
  )
`);

export interface ModelPreferenceRow {
  id: number;
  model_pattern: string;
  provider_name: string;
  action: string;
  priority: number;
  created_at: number;
}

const getAllPreferencesStmt = db.prepare(`SELECT * FROM model_preferences ORDER BY priority DESC, id`);
const insertPreferenceStmt = db.prepare(`
  INSERT INTO model_preferences (model_pattern, provider_name, action, priority)
  VALUES ($pattern, $provider, $action, $priority)
`);
const deletePreferenceStmt = db.prepare(`DELETE FROM model_preferences WHERE id = ?`);

export function loadModelPreferences(): ModelPreferenceRow[] {
  return getAllPreferencesStmt.all() as ModelPreferenceRow[];
}

export function saveModelPreference(pattern: string, provider: string, action: string, priority = 0): number {
  const result = insertPreferenceStmt.run({
    $pattern: pattern,
    $provider: provider,
    $action: action,
    $priority: priority,
  });
  return Number(result.lastInsertRowid);
}

export function removeModelPreference(id: number) {
  deletePreferenceStmt.run(id);
}

// ── Model toggles ────────────────────────────────────────────────────────

db.run(`
  CREATE TABLE IF NOT EXISTS model_toggles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer) * 1000),
    UNIQUE(model_id, provider_name)
  )
`);

export interface ModelToggleRow {
  id: number;
  model_id: string;
  provider_name: string;
  enabled: number;
  updated_at: number;
}

const getAllModelTogglesStmt = db.prepare(`SELECT * FROM model_toggles`);
const getDisabledModelsStmt = db.prepare(`SELECT model_id, provider_name FROM model_toggles WHERE enabled = 0`);
const upsertModelToggleStmt = db.prepare(`
  INSERT INTO model_toggles (model_id, provider_name, enabled, updated_at)
  VALUES ($modelId, $provider, $enabled, $now)
  ON CONFLICT(model_id, provider_name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
`);

export function loadAllModelToggles(): ModelToggleRow[] {
  return getAllModelTogglesStmt.all() as ModelToggleRow[];
}

export function loadDisabledModels(): { model_id: string; provider_name: string }[] {
  return getDisabledModelsStmt.all() as { model_id: string; provider_name: string }[];
}

export function saveModelToggle(modelId: string, provider: string, enabled: boolean) {
  upsertModelToggleStmt.run({
    $modelId: modelId,
    $provider: provider,
    $enabled: enabled ? 1 : 0,
    $now: Date.now(),
  });
}

// ── Routing rules ────────────────────────────────────────────────────────

db.run(`
  CREATE TABLE IF NOT EXISTS routing_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    match_type TEXT NOT NULL DEFAULT 'content_general',
    match_value TEXT NOT NULL DEFAULT '{}',
    target_model TEXT NOT NULL,
    target_provider TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer) * 1000)
  )
`);

export interface RoutingRuleRow {
  id: number;
  name: string;
  match_type: string;
  match_value: string;
  target_model: string;
  target_provider: string | null;
  priority: number;
  enabled: number;
  created_at: number;
}

const getAllRoutingRulesStmt = db.prepare(`SELECT * FROM routing_rules WHERE enabled = 1 ORDER BY priority DESC, id`);
const getAllRoutingRulesIncDisabledStmt = db.prepare(`SELECT * FROM routing_rules ORDER BY priority DESC, id`);
const insertRoutingRuleStmt = db.prepare(`
  INSERT INTO routing_rules (name, match_type, match_value, target_model, target_provider, priority, enabled)
  VALUES ($name, $matchType, $matchValue, $targetModel, $targetProvider, $priority, $enabled)
`);
const updateRoutingRuleStmt = db.prepare(`
  UPDATE routing_rules SET name=$name, match_type=$matchType, match_value=$matchValue,
    target_model=$targetModel, target_provider=$targetProvider, priority=$priority, enabled=$enabled
  WHERE id = $id
`);
const deleteRoutingRuleStmt = db.prepare(`DELETE FROM routing_rules WHERE id = ?`);

export function loadRoutingRules(includeDisabled = false): RoutingRuleRow[] {
  return (includeDisabled ? getAllRoutingRulesIncDisabledStmt : getAllRoutingRulesStmt).all() as RoutingRuleRow[];
}

export function saveRoutingRule(
  name: string, matchType: string, matchValue: string,
  targetModel: string, targetProvider: string | null,
  priority: number, enabled: boolean,
): number {
  const result = insertRoutingRuleStmt.run({
    $name: name,
    $matchType: matchType,
    $matchValue: matchValue,
    $targetModel: targetModel,
    $targetProvider: targetProvider ?? null,
    $priority: priority,
    $enabled: enabled ? 1 : 0,
  });
  return Number(result.lastInsertRowid);
}

export function updateRoutingRuleById(
  id: number, name: string, matchType: string, matchValue: string,
  targetModel: string, targetProvider: string | null,
  priority: number, enabled: boolean,
) {
  updateRoutingRuleStmt.run({
    $id: id,
    $name: name,
    $matchType: matchType,
    $matchValue: matchValue,
    $targetModel: targetModel,
    $targetProvider: targetProvider ?? null,
    $priority: priority,
    $enabled: enabled ? 1 : 0,
  });
}

export function removeRoutingRule(id: number) {
  deleteRoutingRuleStmt.run(id);
}

// Prune on startup (keep 30 days)
pruneOldRequests(30);
