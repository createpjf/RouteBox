// ---------------------------------------------------------------------------
// Metrics store — backed by SQLite for persistence across restarts
// ---------------------------------------------------------------------------

import { providers, type ProviderConfig } from "./providers";
import {
  persistRequest,
  loadRecentRequests,
  loadAggregate,
  saveAggregate,
  loadSetting,
  saveSetting,
  loadTodayRequestsByProvider,
  queryMonthSpend,
} from "./db";

export interface RequestRecord {
  id: string;
  timestamp: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  latencyMs: number;
  status: "success" | "error" | "fallback";
  /** Original model before routing */
  requestedModel?: string;
  /** Was this a fallback route? */
  isFallback?: boolean;
  /** Strategy active at request time */
  routingStrategy?: string;
}

export interface ProviderSnapshot {
  name: string;
  latency: number;
  isUp: boolean;
  keySource: "byok" | "pool";
  requestsToday: number;
}

interface ProviderState {
  latencySamples: number[];  // last N latencies
  lastSuccess: number;
  lastFailure: number;
  failStreak: number;
  requestsToday: number;
  keySource: "byok" | "pool";
}

const MAX_LOG = 200;
const MAX_SPARKLINE = 30;
const LATENCY_WINDOW = 20;
const DOWN_FAIL_STREAK = 3;

class MetricsStore {
  private log: RequestRecord[] = [];
  private providerState = new Map<string, ProviderState>();

  // Aggregate counters (loaded from DB)
  totalRequests = 0;
  totalTokens = 0;
  totalCost = 0;
  totalSaved = 0;

  // Per-minute request count for sparkline
  private minuteBuckets = new Map<string, number>();

  // Previous-period deltas
  private prevRequests = 0;
  private prevTokens = 0;
  private prevCost = 0;

  // Balance (cumulative spend, starts at 0)
  balance = 0;

  // Routing / traffic state
  routingStrategy = "smart_auto";
  trafficPaused = false;

  // Budget
  budget = 0;
  monthSpend = 0;
  private budgetAlert80Sent = "";
  private budgetAlert100Sent = "";
  private currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  pendingAlert: { title: string; message: string } | null = null;

  constructor() {
    // Seed provider state from configured providers
    for (const p of providers) {
      this.providerState.set(p.name, {
        latencySamples: [],
        lastSuccess: 0,
        lastFailure: 0,
        failStreak: 0,
        requestsToday: 0,
        keySource: p.keySource,
      });
    }

    // ── Restore from DB ──
    this.totalRequests = loadAggregate("totalRequests");
    this.totalTokens = loadAggregate("totalTokens");
    this.totalCost = loadAggregate("totalCost");
    this.totalSaved = loadAggregate("totalSaved");
    this.balance = loadAggregate("balance") || 0;

    // Sync prev to current so first delta is 0
    this.prevRequests = this.totalRequests;
    this.prevTokens = this.totalTokens;
    this.prevCost = this.totalCost;

    // Load recent request log into memory
    this.log = loadRecentRequests(MAX_LOG);

    // Rebuild sparkline buckets from recent log
    for (const rec of this.log) {
      const key = new Date(rec.timestamp).toISOString().slice(0, 16);
      this.minuteBuckets.set(key, (this.minuteBuckets.get(key) ?? 0) + 1);
    }

    // Restore per-provider today counts
    const todayCounts = loadTodayRequestsByProvider();
    for (const [name, count] of todayCounts) {
      const ps = this.providerState.get(name);
      if (ps) ps.requestsToday = count;
    }

    // Restore settings
    const savedStrategy = loadSetting("routingStrategy");
    if (savedStrategy) this.routingStrategy = savedStrategy;
    const savedPaused = loadSetting("trafficPaused");
    if (savedPaused) this.trafficPaused = savedPaused === "true";

    // Budget
    const savedBudget = loadSetting("budgetMonthly");
    if (savedBudget) this.budget = parseFloat(savedBudget) || 0;
    this.monthSpend = queryMonthSpend();
    this.budgetAlert80Sent = loadSetting("budgetAlertSent80") ?? "";
    this.budgetAlert100Sent = loadSetting("budgetAlertSent100") ?? "";

    console.log(`   DB restored: ${this.totalRequests} requests, $${this.totalCost.toFixed(4)} cost`);
  }

  /** Record a completed proxy request */
  record(rec: RequestRecord) {
    // Check for month rollover — resync from DB if month changed
    const nowMonth = new Date().toISOString().slice(0, 7);
    if (nowMonth !== this.currentMonth) {
      this.currentMonth = nowMonth;
      this.monthSpend = queryMonthSpend();
      this.budgetAlert80Sent = "";
      this.budgetAlert100Sent = "";
    }

    this.log.push(rec);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);

    this.totalRequests++;
    this.totalTokens += rec.totalTokens;
    this.totalCost += rec.cost;
    this.balance = Math.max(0, this.balance - rec.cost);

    // Provider state
    const ps = this.providerState.get(rec.provider);
    if (ps) {
      ps.requestsToday++;
      if (rec.status === "success" || rec.status === "fallback") {
        ps.latencySamples.push(rec.latencyMs);
        if (ps.latencySamples.length > LATENCY_WINDOW) ps.latencySamples.shift();
        ps.lastSuccess = Date.now();
        ps.failStreak = 0;
      } else {
        ps.lastFailure = Date.now();
        ps.failStreak++;
      }
    }

    // Sparkline bucket
    const minuteKey = new Date().toISOString().slice(0, 16);
    this.minuteBuckets.set(minuteKey, (this.minuteBuckets.get(minuteKey) ?? 0) + 1);

    // Prune old minute buckets to prevent unbounded growth
    if (this.minuteBuckets.size > MAX_SPARKLINE * 3) {
      const cutoff = new Date(Date.now() - MAX_SPARKLINE * 2 * 60_000).toISOString().slice(0, 16);
      for (const k of this.minuteBuckets.keys()) {
        if (k < cutoff) this.minuteBuckets.delete(k);
      }
    }

    // Budget tracking
    this.monthSpend += rec.cost;
    this.checkBudgetAlerts();

    // ── Persist to DB ──
    persistRequest(rec);
    this.flushAggregates();
  }

  /** Record cost savings */
  recordSaving(amount: number) {
    this.totalSaved += amount;
    saveAggregate("totalSaved", this.totalSaved);
  }

  /** Mark provider as having a health-check failure */
  markProviderDown(name: string) {
    const ps = this.providerState.get(name);
    if (ps) {
      ps.lastFailure = Date.now();
      ps.failStreak++;
    }
  }

  /** Persist routing strategy */
  setRoutingStrategy(strategy: string) {
    this.routingStrategy = strategy;
    saveSetting("routingStrategy", strategy);
  }

  /** Set monthly budget */
  setBudget(amount: number) {
    this.budget = amount;
    saveSetting("budgetMonthly", String(amount));
  }

  /** Check budget thresholds and queue alerts */
  private checkBudgetAlerts() {
    if (this.budget <= 0) return;
    const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"

    if (this.monthSpend >= this.budget && this.budgetAlert100Sent !== currentMonth) {
      this.pendingAlert = {
        title: "Budget Exceeded",
        message: `Monthly spend ($${this.monthSpend.toFixed(2)}) has exceeded your $${this.budget.toFixed(2)} budget.`,
      };
      this.budgetAlert100Sent = currentMonth;
      saveSetting("budgetAlertSent100", currentMonth);
    } else if (this.monthSpend >= this.budget * 0.8 && this.budgetAlert80Sent !== currentMonth) {
      this.pendingAlert = {
        title: "Budget Warning",
        message: `Monthly spend ($${this.monthSpend.toFixed(2)}) has reached 80% of your $${this.budget.toFixed(2)} budget.`,
      };
      this.budgetAlert80Sent = currentMonth;
      saveSetting("budgetAlertSent80", currentMonth);
    }
  }

  /** Persist traffic paused state */
  setTrafficPaused(paused: boolean) {
    this.trafficPaused = paused;
    saveSetting("trafficPaused", String(paused));
  }

  /** Get recent request log */
  getRecentLog(n = 100): RequestRecord[] {
    return this.log.slice(-n);
  }

  /** Get new log entries since a given id */
  getLogSince(afterId?: string): RequestRecord[] {
    if (!afterId) return this.log.slice(-10);
    const idx = this.log.findIndex((r) => r.id === afterId);
    if (idx === -1) return this.log.slice(-10);
    return this.log.slice(idx + 1);
  }

  /** Build the full stats snapshot */
  getStats() {
    const providerSnapshots: ProviderSnapshot[] = [];
    for (const p of providers) {
      const ps = this.providerState.get(p.name)!;
      const avgLatency = ps.latencySamples.length
        ? Math.round(ps.latencySamples.reduce((a, b) => a + b, 0) / ps.latencySamples.length)
        : 0;
      const isUp = ps.failStreak < DOWN_FAIL_STREAK;
      providerSnapshots.push({
        name: p.name,
        latency: avgLatency,
        isUp,
        keySource: ps.keySource,
        requestsToday: ps.requestsToday,
      });
    }

    // Sparkline — last 30 minutes
    const sparkline: number[] = [];
    const nowMin = new Date();
    for (let i = MAX_SPARKLINE - 1; i >= 0; i--) {
      const d = new Date(nowMin.getTime() - i * 60_000);
      const key = d.toISOString().slice(0, 16);
      sparkline.push(this.minuteBuckets.get(key) ?? 0);
    }

    // Deltas
    const reqDelta = this.prevRequests > 0
      ? Math.round(((this.totalRequests - this.prevRequests) / this.prevRequests) * 100)
      : 0;
    const tokDelta = this.prevTokens > 0
      ? Math.round(((this.totalTokens - this.prevTokens) / this.prevTokens) * 100)
      : 0;
    const costDelta = this.prevCost > 0
      ? Math.round(((this.totalCost - this.prevCost) / this.prevCost) * 100)
      : 0;

    this.prevRequests = this.totalRequests;
    this.prevTokens = this.totalTokens;
    this.prevCost = this.totalCost;

    return {
      requests: this.totalRequests,
      tokens: this.totalTokens,
      cost: +this.totalCost.toFixed(4),
      saved: +this.totalSaved.toFixed(4),
      requestsDelta: reqDelta,
      tokensDelta: tokDelta,
      costDelta: costDelta,
      sparkline,
      providers: providerSnapshots,
      balance: +this.balance.toFixed(2),
      budget: this.budget,
      monthSpend: +this.monthSpend.toFixed(4),
    };
  }

  /** Get latest latency for a provider (real-time); falls back to EMA, then Infinity */
  getProviderLatency(name: string): number {
    const ps = this.providerState.get(name);
    if (!ps || ps.latencySamples.length === 0) return Infinity;
    // Use the most recent sample as the real-time signal
    return ps.latencySamples[ps.latencySamples.length - 1];
  }

  /** Get exponentially-weighted moving average latency (recent samples weighted more) */
  getProviderEmaLatency(name: string): number {
    const ps = this.providerState.get(name);
    if (!ps || ps.latencySamples.length === 0) return Infinity;
    const alpha = 0.3; // weight for newest sample
    let ema = ps.latencySamples[0];
    for (let i = 1; i < ps.latencySamples.length; i++) {
      ema = alpha * ps.latencySamples[i] + (1 - alpha) * ema;
    }
    return ema;
  }

  /** Seed an initial latency sample (used by startup probe) */
  seedLatency(name: string, latencyMs: number) {
    const ps = this.providerState.get(name);
    if (ps && ps.latencySamples.length === 0) {
      ps.latencySamples.push(latencyMs);
    }
  }

  /** Check if a provider is considered up */
  isProviderUp(name: string): boolean {
    const ps = this.providerState.get(name);
    if (!ps) return false;
    return ps.failStreak < DOWN_FAIL_STREAK;
  }

  /** Sync provider state when providers array changes (after rebuildProviders) */
  syncProviders() {
    // Add new providers
    for (const p of providers) {
      if (!this.providerState.has(p.name)) {
        this.providerState.set(p.name, {
          latencySamples: [],
          lastSuccess: 0,
          lastFailure: 0,
          failStreak: 0,
          requestsToday: 0,
          keySource: p.keySource,
        });
      }
    }
    // Remove stale providers
    const activeNames = new Set(providers.map(p => p.name));
    for (const name of this.providerState.keys()) {
      if (!activeNames.has(name)) {
        this.providerState.delete(name);
      }
    }
  }

  /** Flush aggregate counters to DB (batched) */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushAggregates() {
    // Debounce — flush at most once per second
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      saveAggregate("totalRequests", this.totalRequests);
      saveAggregate("totalTokens", this.totalTokens);
      saveAggregate("totalCost", this.totalCost);
      saveAggregate("totalSaved", this.totalSaved);
      saveAggregate("balance", this.balance);
    }, 1000);
  }
}

export const metrics = new MetricsStore();
