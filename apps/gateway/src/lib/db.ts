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

// ── V2: Conversations ─────────────────────────────────────────────────────

db.run(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    model TEXT NOT NULL DEFAULT '',
    strategy TEXT NOT NULL DEFAULT 'smart_auto',
    msg_count INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer) * 1000),
    updated_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer) * 1000)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    cache_hit INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer) * 1000)
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conv_ts ON messages(conversation_id, created_at)`);

db.run(`
  CREATE TABLE IF NOT EXISTS spotlight_history (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    response TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT '',
    cost REAL NOT NULL DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s','now') as integer) * 1000)
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_spotlight_created ON spotlight_history(created_at DESC)`);

// Enable foreign key enforcement for CASCADE
db.run("PRAGMA foreign_keys = ON");

// ── V2: Conversation types ────────────────────────────────────────────────

export interface ConversationRow {
  id: string;
  title: string;
  model: string;
  strategy: string;
  msg_count: number;
  total_tokens: number;
  total_cost: number;
  pinned: number;
  archived: number;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  latency_ms: number;
  cache_hit: number;
  created_at: number;
}

export interface SpotlightHistoryRow {
  id: string;
  prompt: string;
  response: string;
  model: string;
  provider: string;
  cost: number;
  tokens: number;
  latency_ms: number;
  created_at: number;
}

// ── V2: Conversation prepared statements ──────────────────────────────────

const insertConversationStmt = db.prepare(`
  INSERT INTO conversations (id, title, model, strategy, created_at, updated_at)
  VALUES ($id, $title, $model, $strategy, $now, $now)
`);

const updateConversationStmt = db.prepare(`
  UPDATE conversations SET title=$title, model=$model, strategy=$strategy, updated_at=$now
  WHERE id = $id
`);

const updateConversationStatsStmt = db.prepare(`
  UPDATE conversations SET msg_count=$msgCount, total_tokens=$totalTokens, total_cost=$totalCost, updated_at=$now
  WHERE id = $id
`);

const getConversationsStmt = db.prepare(`
  SELECT * FROM conversations WHERE archived = 0
  ORDER BY pinned DESC, updated_at DESC
`);

const getConversationStmt = db.prepare(`
  SELECT * FROM conversations WHERE id = ?
`);

const deleteConversationStmt = db.prepare(`
  DELETE FROM conversations WHERE id = ?
`);

const togglePinStmt = db.prepare(`
  UPDATE conversations SET pinned = CASE WHEN pinned = 0 THEN 1 ELSE 0 END, updated_at = ? WHERE id = ?
`);

const archiveConversationStmt = db.prepare(`
  UPDATE conversations SET archived = 1, updated_at = ? WHERE id = ?
`);

// ── V2: Message prepared statements ───────────────────────────────────────

const insertMessageStmt = db.prepare(`
  INSERT INTO messages (id, conversation_id, role, content, model, provider, input_tokens, output_tokens, cost, latency_ms, cache_hit, created_at)
  VALUES ($id, $convId, $role, $content, $model, $provider, $inputTokens, $outputTokens, $cost, $latencyMs, $cacheHit, $now)
`);

const getMessagesStmt = db.prepare(`
  SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
`);

// ── V2: Spotlight prepared statements ─────────────────────────────────────

const insertSpotlightStmt = db.prepare(`
  INSERT INTO spotlight_history (id, prompt, response, model, provider, cost, tokens, latency_ms, created_at)
  VALUES ($id, $prompt, $response, $model, $provider, $cost, $tokens, $latencyMs, $now)
`);

const getRecentSpotlightStmt = db.prepare(`
  SELECT * FROM spotlight_history ORDER BY created_at DESC LIMIT ?
`);

// ── V2: Usage query prepared statements ───────────────────────────────────

const usageTodayStmt = db.prepare(`
  SELECT COUNT(*) as requests, COALESCE(SUM(total_tokens), 0) as tokens,
         COALESCE(SUM(cost), 0) as cost
  FROM requests WHERE timestamp >= ?
`);

const usageMonthStmt = db.prepare(`
  SELECT COUNT(*) as requests, COALESCE(SUM(total_tokens), 0) as tokens,
         COALESCE(SUM(cost), 0) as cost
  FROM requests WHERE timestamp >= ?
`);

const weeklyTrendStmt = db.prepare(`
  SELECT strftime('%Y-%m-%d', timestamp/1000, 'unixepoch') as date,
         COALESCE(SUM(cost), 0) as cost, COUNT(*) as requests
  FROM requests WHERE timestamp >= ?
  GROUP BY date ORDER BY date
`);

const modelBreakdownStmt = db.prepare(`
  SELECT model, COUNT(*) as requests, COALESCE(SUM(cost), 0) as cost
  FROM requests WHERE timestamp >= ?
  GROUP BY model ORDER BY cost DESC LIMIT 10
`);

// ── V2: Conversation CRUD ─────────────────────────────────────────────────

export function createConversation(title: string, model: string, strategy = "smart_auto"): ConversationRow {
  const id = crypto.randomUUID();
  const now = Date.now();
  insertConversationStmt.run({ $id: id, $title: title, $model: model, $strategy: strategy, $now: now });
  return getConversationStmt.get(id) as ConversationRow;
}

export function updateConversation(id: string, title: string, model: string, strategy: string) {
  updateConversationStmt.run({ $id: id, $title: title, $model: model, $strategy: strategy, $now: Date.now() });
}

export function loadConversations(): ConversationRow[] {
  return getConversationsStmt.all() as ConversationRow[];
}

export function loadConversation(id: string): ConversationRow | null {
  return (getConversationStmt.get(id) as ConversationRow | null) ?? null;
}

export function deleteConversation(id: string) {
  deleteConversationStmt.run(id);
}

export function togglePinConversation(id: string) {
  togglePinStmt.run(Date.now(), id);
}

export function archiveConversation(id: string) {
  archiveConversationStmt.run(Date.now(), id);
}

// ── V2: Message CRUD ──────────────────────────────────────────────────────

export function insertMessage(
  conversationId: string,
  role: string,
  content: string,
  meta?: { model?: string; provider?: string; inputTokens?: number; outputTokens?: number; cost?: number; latencyMs?: number; cacheHit?: boolean },
): MessageRow {
  const id = crypto.randomUUID();
  const now = Date.now();
  insertMessageStmt.run({
    $id: id,
    $convId: conversationId,
    $role: role,
    $content: content,
    $model: meta?.model ?? "",
    $provider: meta?.provider ?? "",
    $inputTokens: meta?.inputTokens ?? 0,
    $outputTokens: meta?.outputTokens ?? 0,
    $cost: meta?.cost ?? 0,
    $latencyMs: meta?.latencyMs ?? 0,
    $cacheHit: meta?.cacheHit ? 1 : 0,
    $now: now,
  });
  // Update conversation stats
  const msgs = getMessagesStmt.all(conversationId) as MessageRow[];
  const totalTokens = msgs.reduce((s, m) => s + m.input_tokens + m.output_tokens, 0);
  const totalCost = msgs.reduce((s, m) => s + m.cost, 0);
  updateConversationStatsStmt.run({
    $id: conversationId,
    $msgCount: msgs.length,
    $totalTokens: totalTokens,
    $totalCost: totalCost,
    $now: now,
  });
  return { id, conversation_id: conversationId, role, content, model: meta?.model ?? "", provider: meta?.provider ?? "", input_tokens: meta?.inputTokens ?? 0, output_tokens: meta?.outputTokens ?? 0, cost: meta?.cost ?? 0, latency_ms: meta?.latencyMs ?? 0, cache_hit: meta?.cacheHit ? 1 : 0, created_at: now };
}

export function loadMessages(conversationId: string): MessageRow[] {
  return getMessagesStmt.all(conversationId) as MessageRow[];
}

// ── V2: Spotlight CRUD ────────────────────────────────────────────────────

export function saveSpotlightEntry(prompt: string, response: string, meta?: { model?: string; provider?: string; cost?: number; tokens?: number; latencyMs?: number }): SpotlightHistoryRow {
  const id = crypto.randomUUID();
  const now = Date.now();
  insertSpotlightStmt.run({
    $id: id,
    $prompt: prompt,
    $response: response,
    $model: meta?.model ?? "",
    $provider: meta?.provider ?? "",
    $cost: meta?.cost ?? 0,
    $tokens: meta?.tokens ?? 0,
    $latencyMs: meta?.latencyMs ?? 0,
    $now: now,
  });
  return { id, prompt, response, model: meta?.model ?? "", provider: meta?.provider ?? "", cost: meta?.cost ?? 0, tokens: meta?.tokens ?? 0, latency_ms: meta?.latencyMs ?? 0, created_at: now };
}

export function loadRecentSpotlight(limit = 3): SpotlightHistoryRow[] {
  return getRecentSpotlightStmt.all(limit) as SpotlightHistoryRow[];
}

// ── V2: Usage queries ─────────────────────────────────────────────────────

export interface UsageTodayResult { requests: number; tokens: number; cost: number; saved: number }
export interface UsageMonthResult { requests: number; tokens: number; cost: number; budgetPct: number }
export interface WeeklyTrendRow { date: string; cost: number; requests: number }
export interface ModelBreakdownRow { model: string; requests: number; cost: number; pct: number }

export function queryTodayUsage(): UsageTodayResult {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const row = usageTodayStmt.get(startOfDay.getTime()) as { requests: number; tokens: number; cost: number } | null;
  const cost = row?.cost ?? 0;
  // "saved" = cost from fallback requests where a cheaper provider was used
  // Approximation: sum of savings from requests marked as fallback
  return { requests: row?.requests ?? 0, tokens: row?.tokens ?? 0, cost, saved: 0 };
}

export function queryMonthUsage(): UsageMonthResult {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const row = usageMonthStmt.get(startOfMonth) as { requests: number; tokens: number; cost: number } | null;
  const cost = row?.cost ?? 0;
  const budgetStr = loadSetting("monthly_budget");
  const budget = budgetStr ? parseFloat(budgetStr) : 0;
  const budgetPct = budget > 0 ? Math.round((cost / budget) * 100) : 0;
  return { requests: row?.requests ?? 0, tokens: row?.tokens ?? 0, cost, budgetPct };
}

export function queryWeeklyTrend(sinceTs?: number): WeeklyTrendRow[] {
  const since = sinceTs ?? Date.now() - 7 * 86_400_000;
  return weeklyTrendStmt.all(since) as WeeklyTrendRow[];
}

export function queryModelBreakdown(sinceTs?: number): ModelBreakdownRow[] {
  const since = sinceTs ?? Date.now() - 30 * 86_400_000;
  const rows = modelBreakdownStmt.all(since) as { model: string; requests: number; cost: number }[];
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  return rows.map(r => ({ ...r, pct: totalCost > 0 ? Math.round((r.cost / totalCost) * 100) : 0 }));
}

// Prune on startup (keep 30 days)
pruneOldRequests(30);
