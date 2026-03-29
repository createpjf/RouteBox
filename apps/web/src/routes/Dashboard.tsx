import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { DollarSign, Zap, Activity, Clock, Key, CreditCard, ArrowRight, Copy, Check } from "lucide-react";
import { StatsCard } from "@/components/StatsCard";
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
      api.getRequests(undefined, 5),
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
        <div className="h-8 w-48 skeleton" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 skeleton rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const totals = analytics?.totals;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary mt-1">Overview of your RouteBox Cloud usage</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          label="Balance"
          value={account ? formatCost(account.balanceCents + account.bonusCents) : "$0.00"}
          sub={account?.bonusCents ? `${formatCost(account.bonusCents)} bonus` : undefined}
          icon={<DollarSign size={18} />}
        />
        <StatsCard
          label="Today's Requests"
          value={formatNumber(totals?.requests || 0)}
          icon={<Activity size={18} />}
        />
        <StatsCard
          label="Today's Cost"
          value={`$${(totals?.cost || 0).toFixed(4)}`}
          icon={<Zap size={18} />}
        />
        <StatsCard
          label="Avg Latency"
          value={totals?.avgLatency ? `${Math.round(totals.avgLatency)}ms` : "—"}
          icon={<Clock size={18} />}
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button onClick={copyEndpoint} className="glass-card-static p-4 flex items-center gap-3 text-left hover:border-accent-ember/20 transition-colors">
          {copied ? <Check size={20} className="text-accent-green" /> : <Copy size={20} className="text-accent-ember" />}
          <div>
            <div className="text-sm font-medium text-text-primary">API Endpoint</div>
            <div className="text-xs text-text-tertiary font-mono">{API_BASE_URL}/v1</div>
          </div>
        </button>

        <Link to="/account" className="glass-card-static p-4 flex items-center gap-3 hover:border-accent-ember/20 transition-colors">
          <Key size={20} className="text-accent-blue" />
          <div>
            <div className="text-sm font-medium text-text-primary">API Keys</div>
            <div className="text-xs text-text-tertiary">Manage your keys</div>
          </div>
        </Link>

        <Link to="/billing" className="glass-card-static p-4 flex items-center gap-3 hover:border-accent-ember/20 transition-colors">
          <CreditCard size={20} className="text-accent-green" />
          <div>
            <div className="text-sm font-medium text-text-primary">Add Credits</div>
            <div className="text-xs text-text-tertiary">Top up your balance</div>
          </div>
        </Link>
      </div>

      {/* Recent Requests */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Recent Requests</h2>
          <Link to="/usage" className="text-sm text-accent-ember hover:underline flex items-center gap-1">
            View all <ArrowRight size={14} />
          </Link>
        </div>

        {recentRequests.length === 0 ? (
          <div className="glass-card-static p-8 text-center text-text-secondary">
            No requests yet. Send your first API call to get started.
          </div>
        ) : (
          <div className="glass-card-static overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-tertiary text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-semibold">Model</th>
                  <th className="text-left px-4 py-3 font-semibold">Provider</th>
                  <th className="text-right px-4 py-3 font-semibold">Tokens</th>
                  <th className="text-right px-4 py-3 font-semibold">Cost</th>
                  <th className="text-right px-4 py-3 font-semibold">Latency</th>
                </tr>
              </thead>
              <tbody>
                {recentRequests.map((r) => (
                  <tr key={r.id} className="border-b border-border-light hover:bg-bg-row-hover transition-colors">
                    <td className="px-4 py-3 font-medium text-text-primary font-mono text-xs">{r.model}</td>
                    <td className="px-4 py-3 text-text-secondary">{r.provider}</td>
                    <td className="px-4 py-3 text-right text-text-secondary">
                      {formatNumber(r.inputTokens + r.outputTokens)}
                    </td>
                    <td className="px-4 py-3 text-right text-text-primary">${r.cost.toFixed(4)}</td>
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
