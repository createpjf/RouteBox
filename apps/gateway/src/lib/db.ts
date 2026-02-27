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

// Index for time-range queries
db.run(`
  CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp)
`);

// ── Prepared statements ─────────────────────────────────────────────────────

const insertRequest = db.prepare(`
  INSERT OR IGNORE INTO requests (id, timestamp, provider, model, input_tokens, output_tokens, total_tokens, cost, latency_ms, status)
  VALUES ($id, $timestamp, $provider, $model, $inputTokens, $outputTokens, $totalTokens, $cost, $latencyMs, $status)
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
  });
}

export function loadRecentRequests(limit = 200): RequestRecord[] {
  const rows = getRecentRequests.all(limit) as {
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
  }[];
  // Reverse to chronological order (oldest first)
  return rows.reverse().map((r) => ({
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
  }));
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

// Prune on startup (keep 30 days)
pruneOldRequests(30);
