// ---------------------------------------------------------------------------
// Cloud Analytics — PostgreSQL queries for per-user usage analytics
// Returns the same AnalyticsResponse format as the local gateway
// ---------------------------------------------------------------------------

import { sql } from "./db-cloud";

// ---------------------------------------------------------------------------
// Types (mirrors desktop AnalyticsResponse)
// ---------------------------------------------------------------------------

interface AnalyticsTimeSeriesPoint {
  date: string;
  cost: number;
  tokens: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

interface AnalyticsResponse {
  period: string;
  timeSeries: AnalyticsTimeSeriesPoint[];
  providerBreakdown: { provider: string; requests: number; cost: number; tokens: number }[];
  topModels: { model: string; requests: number; cost: number }[];
  totals: { requests: number; tokens: number; cost: number; avgLatency: number };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

async function queryTimeSeries(
  userId: string,
  sinceTs: number,
  groupBy: "hour" | "day",
) {
  const since = new Date(sinceTs);
  const fmt = groupBy === "hour" ? "YYYY-MM-DD HH24:00" : "YYYY-MM-DD";

  const rows = await sql`
    SELECT
      TO_CHAR(created_at AT TIME ZONE 'UTC', ${fmt}) AS date,
      SUM(cost_cents)::float / 100 AS total_cost,
      SUM(input_tokens + output_tokens) AS total_tokens,
      COUNT(*)::int AS request_count,
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens
    FROM requests
    WHERE user_id = ${userId}
      AND created_at >= ${since}
    GROUP BY date
    ORDER BY date
  `;

  return rows.map((r) => ({
    date: r.date as string,
    total_cost: Number(r.total_cost ?? 0),
    total_tokens: Number(r.total_tokens ?? 0),
    request_count: Number(r.request_count ?? 0),
    input_tokens: Number(r.input_tokens ?? 0),
    output_tokens: Number(r.output_tokens ?? 0),
  }));
}

async function queryProviderBreakdown(userId: string, sinceTs: number) {
  const since = new Date(sinceTs);
  const rows = await sql`
    SELECT
      provider,
      COUNT(*)::int AS requests,
      SUM(cost_cents)::float / 100 AS cost,
      SUM(input_tokens + output_tokens) AS tokens
    FROM requests
    WHERE user_id = ${userId}
      AND created_at >= ${since}
    GROUP BY provider
    ORDER BY cost DESC
  `;
  return rows.map((r) => ({
    provider: r.provider as string,
    requests: Number(r.requests ?? 0),
    cost: Number(r.cost ?? 0),
    tokens: Number(r.tokens ?? 0),
  }));
}

async function queryTopModels(userId: string, sinceTs: number, limit = 5) {
  const since = new Date(sinceTs);
  const rows = await sql`
    SELECT
      model,
      COUNT(*)::int AS requests,
      SUM(cost_cents)::float / 100 AS cost
    FROM requests
    WHERE user_id = ${userId}
      AND created_at >= ${since}
    GROUP BY model
    ORDER BY requests DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    model: r.model as string,
    requests: Number(r.requests ?? 0),
    cost: Number(r.cost ?? 0),
  }));
}

async function queryTotals(userId: string, sinceTs: number) {
  const since = new Date(sinceTs);
  const [row] = await sql`
    SELECT
      COUNT(*)::int AS requests,
      COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
      COALESCE(SUM(cost_cents)::float / 100, 0) AS cost,
      COALESCE(ROUND(AVG(latency_ms)), 0)::int AS avg_latency
    FROM requests
    WHERE user_id = ${userId}
      AND created_at >= ${since}
  `;
  return {
    requests: Number(row?.requests ?? 0),
    tokens: Number(row?.tokens ?? 0),
    cost: Number(row?.cost ?? 0),
    avgLatency: Number(row?.avg_latency ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Build complete time slots (zero-fill for charts)
// ---------------------------------------------------------------------------

function buildHourlySlots(): string[] {
  const slots: string[] = [];
  const now = new Date();
  const ymd = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  for (let h = 0; h < 24; h++) {
    slots.push(`${ymd} ${String(h).padStart(2, "0")}:00`);
  }
  return slots;
}

function buildDailySlots(days: number): string[] {
  const slots: string[] = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    const d = new Date(now - (days - 1 - i) * 86_400_000);
    slots.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    );
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Main analytics function
// ---------------------------------------------------------------------------

export async function getCloudAnalytics(
  userId: string,
  period: string,
): Promise<AnalyticsResponse> {
  const now = Date.now();
  let sinceTs: number;
  let groupBy: "hour" | "day";
  let slots: string[];

  switch (period) {
    case "7d":
      sinceTs = now - 7 * 86_400_000;
      groupBy = "day";
      slots = buildDailySlots(7);
      break;
    case "30d":
      sinceTs = now - 30 * 86_400_000;
      groupBy = "day";
      slots = buildDailySlots(30);
      break;
    default: {
      // today — from start of UTC day
      const d = new Date(now);
      sinceTs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      groupBy = "hour";
      slots = buildHourlySlots();
      break;
    }
  }

  // Run queries in parallel
  const [rawSeries, providerBreakdown, topModels, totals] = await Promise.all([
    queryTimeSeries(userId, sinceTs, groupBy),
    queryProviderBreakdown(userId, sinceTs),
    queryTopModels(userId, sinceTs),
    queryTotals(userId, sinceTs),
  ]);

  // Zero-fill time series
  const seriesMap = new Map(rawSeries.map((r) => [r.date, r]));
  const timeSeries: AnalyticsTimeSeriesPoint[] = slots.map((date) => {
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

  return {
    period,
    timeSeries,
    providerBreakdown,
    topModels,
    totals,
  };
}
