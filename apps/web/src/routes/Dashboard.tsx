import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Copy, Check, ArrowRight } from "lucide-react";
import * as api from "@/lib/api";
import { API_BASE_URL } from "@/lib/constants";

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Model pricing data (per million tokens) — matches cloud gateway model_registry
const MODEL_PRICING = [
  { model: "claude-opus-4-6", input: 0.80, output: 4.00, cacheWrite: 1.00, cacheRead: 0.08, officialIn: 5, officialOut: 25 },
  { model: "claude-sonnet-4-6", input: 0.48, output: 2.40, cacheWrite: 0.60, cacheRead: 0.05, officialIn: 3, officialOut: 15 },
  { model: "claude-haiku-4-5", input: 0.16, output: 0.80, cacheWrite: 0.20, cacheRead: 0.02, officialIn: 1, officialOut: 5 },
  { model: "gpt-5.4", input: 0.20, output: 0.80, cacheWrite: 0.25, cacheRead: 0.02, officialIn: 2.5, officialOut: 10 },
  { model: "gpt-4o", input: 0.20, output: 0.80, cacheWrite: 0.25, cacheRead: 0.02, officialIn: 2.5, officialOut: 10 },
  { model: "gpt-4o-mini", input: 0.01, output: 0.05, cacheWrite: null, cacheRead: null, officialIn: 0.15, officialOut: 0.6 },
  { model: "gemini-2.5-pro", input: 0.10, output: 0.80, cacheWrite: null, cacheRead: null, officialIn: 1.25, officialOut: 10 },
  { model: "gemini-2.5-flash", input: 0.01, output: 0.05, cacheWrite: null, cacheRead: null, officialIn: 0.15, officialOut: 0.6 },
  { model: "deepseek-chat", input: 0.02, output: 0.09, cacheWrite: null, cacheRead: null, officialIn: 0.27, officialOut: 1.10 },
  { model: "deepseek-reasoner", input: 0.05, output: 0.18, cacheWrite: null, cacheRead: null, officialIn: 0.55, officialOut: 2.19 },
];

function calcSavings(input: number, officialIn: number): string {
  const pct = Math.round((1 - input / officialIn) * 100);
  return `${pct}% off`;
}

export function Dashboard() {
  const [account, setAccount] = useState<api.AccountInfo | null>(null);
  const [analytics, setAnalytics] = useState<api.AnalyticsResponse | null>(null);
  const [recentRequests, setRecentRequests] = useState<api.RequestRecord[]>([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getAccountInfo(),
      api.getAnalytics("today"),
      api.getRequests(undefined, 10),
    ]).then(([acc, anal, req]) => {
      setAccount(acc);
      setAnalytics(anal);
      setRecentRequests(req.requests);
    }).finally(() => setLoading(false));
  }, []);

  function copyEndpoint() {
    navigator.clipboard.writeText(`${API_BASE_URL}/v1`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 skeleton rounded-xl" />)}
        </div>
        <div className="h-80 skeleton rounded-xl" />
      </div>
    );
  }

  const totals = analytics?.totals;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5">
          <div className="text-xs text-text-tertiary uppercase tracking-wider">Balance</div>
          <div className="text-2xl font-bold text-accent-ember mt-1">
            {account ? formatCost(account.balanceCents + account.bonusCents) : "$0.00"}
          </div>
          {account?.bonusCents ? (
            <div className="text-xs text-text-tertiary mt-0.5">{formatCost(account.bonusCents)} bonus</div>
          ) : null}
        </div>
        <div className="card p-5">
          <div className="text-xs text-text-tertiary uppercase tracking-wider">Today's Cost</div>
          <div className="text-2xl font-bold text-text-primary mt-1">
            ${(totals?.cost || 0).toFixed(4)}
          </div>
          <div className="text-xs text-text-tertiary mt-0.5">{formatNumber(totals?.tokens || 0)} tokens</div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-text-tertiary uppercase tracking-wider">Requests</div>
          <div className="text-2xl font-bold text-text-primary mt-1">
            {formatNumber(totals?.requests || 0)}
          </div>
          <div className="text-xs text-text-tertiary mt-0.5">today</div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-text-tertiary uppercase tracking-wider">Avg Latency</div>
          <div className="text-2xl font-bold text-text-primary mt-1">
            {totals?.avgLatency ? `${Math.round(totals.avgLatency)}ms` : "—"}
          </div>
        </div>
      </div>

      {/* Quick Start */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-text-primary mb-3">Quick Start</h2>
        <p className="text-sm text-text-secondary mb-4">
          Set the base URL and API key, then use any OpenAI-compatible SDK.
        </p>
        <div className="flex items-center gap-3 bg-bg-elevated rounded-lg px-4 py-3">
          <code className="flex-1 font-mono text-sm text-accent-ember select-all">{API_BASE_URL}/v1</code>
          <button onClick={copyEndpoint} className="btn-ghost h-8 px-2">
            {copied ? <Check size={14} className="text-accent-green" /> : <Copy size={14} />}
          </button>
        </div>
        <div className="flex gap-3 mt-4">
          <Link to="/api" className="btn-primary text-sm h-9 px-4">
            View API Docs <ArrowRight size={14} />
          </Link>
          <Link to="/keys" className="btn-secondary text-sm h-9 px-4">
            Manage API Keys
          </Link>
        </div>
      </div>

      {/* Pricing Table */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-text-primary">Pricing (per Million Tokens)</h2>
          <Link to="/billing" className="text-sm text-accent-ember hover:underline flex items-center gap-1">
            Buy Credits <ArrowRight size={14} />
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-text-tertiary text-xs">
                <th className="text-left px-4 py-3 font-semibold">Model</th>
                <th className="text-right px-4 py-3 font-semibold">Input</th>
                <th className="text-right px-4 py-3 font-semibold">Output</th>
                <th className="text-right px-4 py-3 font-semibold">Cache Write</th>
                <th className="text-right px-4 py-3 font-semibold">Cache Read</th>
                <th className="text-right px-4 py-3 font-semibold">Official</th>
                <th className="text-right px-4 py-3 font-semibold">Savings</th>
              </tr>
            </thead>
            <tbody>
              {MODEL_PRICING.map((m) => (
                <tr key={m.model} className="border-b border-border-light hover:bg-bg-row-hover transition-colors">
                  <td className="px-4 py-3 font-medium text-text-primary font-mono text-xs">{m.model}</td>
                  <td className="px-4 py-3 text-right text-text-primary">${m.input.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-text-primary">${m.output.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-text-secondary">
                    {m.cacheWrite !== null ? `$${m.cacheWrite.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-text-secondary">
                    {m.cacheRead !== null ? `$${m.cacheRead.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-text-tertiary line-through">
                    ${m.officialIn}/{m.officialOut}
                  </td>
                  <td className="px-4 py-3 text-right text-accent-ember font-semibold">
                    {calcSavings(m.input, m.officialIn)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-tertiary mt-3">
          All prices in USD per million tokens. Billed by actual token usage. Official prices last updated: 2026-03-28.
        </p>
      </div>

      {/* Recent Usage */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-text-primary">Usage Details</h2>
          <Link to="/usage" className="text-sm text-accent-ember hover:underline flex items-center gap-1">
            View All <ArrowRight size={14} />
          </Link>
        </div>

        {recentRequests.length === 0 ? (
          <div className="text-center py-8 text-text-secondary text-sm">
            No usage records yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-tertiary text-xs">
                  <th className="text-left px-4 py-3 font-semibold">Time</th>
                  <th className="text-left px-4 py-3 font-semibold">Model</th>
                  <th className="text-right px-4 py-3 font-semibold">Input</th>
                  <th className="text-right px-4 py-3 font-semibold">Output</th>
                  <th className="text-right px-4 py-3 font-semibold">Cost</th>
                  <th className="text-right px-4 py-3 font-semibold">Latency</th>
                </tr>
              </thead>
              <tbody>
                {recentRequests.map((r) => (
                  <tr key={r.id} className="border-b border-border-light hover:bg-bg-row-hover transition-colors">
                    <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-primary">{r.model}</td>
                    <td className="px-4 py-3 text-right text-text-secondary">{formatNumber(r.inputTokens)}</td>
                    <td className="px-4 py-3 text-right text-text-secondary">{formatNumber(r.outputTokens)}</td>
                    <td className="px-4 py-3 text-right text-text-primary font-medium">${r.cost.toFixed(4)}</td>
                    <td className="px-4 py-3 text-right text-text-secondary">{r.latencyMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
