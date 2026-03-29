import { useState, useEffect, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import * as api from "@/lib/api";

const PERIOD_OPTIONS = [
  { value: "today" as const, label: "Today" },
  { value: "7d" as const, label: "7 Days" },
  { value: "30d" as const, label: "30 Days" },
];

const COLORS = ["#ff4d00", "#007AFF", "#34C759", "#AF52DE", "#FF9F0A", "#5AC8FA", "#FF3B30"];

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function Usage() {
  const [period, setPeriod] = useState<"today" | "7d" | "30d">("7d");
  const [analytics, setAnalytics] = useState<api.AnalyticsResponse | null>(null);
  const [requests, setRequests] = useState<api.RequestRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getAnalytics(period),
      api.getRequests(undefined, 20),
    ]).then(([anal, req]) => {
      setAnalytics(anal);
      setRequests(req.requests);
      setNextCursor(req.nextCursor);
    }).finally(() => setLoading(false));
  }, [period]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const res = await api.getRequests(nextCursor, 20);
    setRequests((prev) => [...prev, ...res.requests]);
    setNextCursor(res.nextCursor);
  }, [nextCursor]);

  const totals = analytics?.totals;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Usage Analytics</h1>
          <p className="text-text-secondary mt-1">Track your API usage and costs</p>
        </div>

        {/* Period Toggle */}
        <div className="flex gap-1 bg-bg-card border border-border rounded-lg p-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                period === opt.value
                  ? "bg-accent-ember text-white"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-20 skeleton rounded-2xl" />)}
          </div>
          <div className="h-64 skeleton rounded-2xl" />
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="glass-card-static p-4">
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Requests</div>
              <div className="text-xl font-bold">{formatNumber(totals?.requests || 0)}</div>
            </div>
            <div className="glass-card-static p-4">
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Tokens</div>
              <div className="text-xl font-bold">{formatNumber(totals?.tokens || 0)}</div>
            </div>
            <div className="glass-card-static p-4">
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Cost</div>
              <div className="text-xl font-bold">${(totals?.cost || 0).toFixed(4)}</div>
            </div>
            <div className="glass-card-static p-4">
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Avg Latency</div>
              <div className="text-xl font-bold">{totals?.avgLatency ? `${Math.round(totals.avgLatency)}ms` : "—"}</div>
            </div>
          </div>

          {/* Cost Trend Chart */}
          {analytics && analytics.timeSeries.length > 0 && (
            <div className="glass-card-static p-6">
              <h3 className="text-sm font-semibold text-text-secondary mb-4 uppercase tracking-wider">Cost Trend</h3>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={analytics.timeSeries}>
                  <defs>
                    <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ff4d00" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ff4d00" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#636363" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#636363" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: "#909090" }}
                  />
                  <Area type="monotone" dataKey="cost" stroke="#ff4d00" strokeWidth={2} fill="url(#costGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Model & Provider Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Models */}
            {analytics && analytics.topModels.length > 0 && (
              <div className="glass-card-static p-6">
                <h3 className="text-sm font-semibold text-text-secondary mb-4 uppercase tracking-wider">Top Models</h3>
                <div className="space-y-3">
                  {analytics.topModels.slice(0, 6).map((m, i) => (
                    <div key={m.model} className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="flex-1 text-sm text-text-primary font-mono text-xs truncate">{m.model}</span>
                      <span className="text-xs text-text-secondary">{m.requests} req</span>
                      <span className="text-xs text-text-tertiary w-12 text-right">{m.percentage.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Provider Breakdown */}
            {analytics && analytics.providerBreakdown.length > 0 && (
              <div className="glass-card-static p-6">
                <h3 className="text-sm font-semibold text-text-secondary mb-4 uppercase tracking-wider">Provider Split</h3>
                <div className="flex items-center justify-center">
                  <PieChart width={180} height={180}>
                    <Pie
                      data={analytics.providerBreakdown}
                      dataKey="requests"
                      nameKey="provider"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {analytics.providerBreakdown.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </div>
                <div className="mt-4 space-y-2">
                  {analytics.providerBreakdown.map((p, i) => (
                    <div key={p.provider} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-sm text-text-primary flex-1">{p.provider}</span>
                      <span className="text-xs text-text-tertiary">{p.percentage.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Request Log */}
          <div>
            <h3 className="text-sm font-semibold text-text-secondary mb-4 uppercase tracking-wider">Request History</h3>
            {requests.length === 0 ? (
              <div className="glass-card-static p-8 text-center text-text-secondary">No requests found.</div>
            ) : (
              <>
                <div className="glass-card-static overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-text-tertiary text-xs uppercase tracking-wider">
                        <th className="text-left px-4 py-3 font-semibold">Time</th>
                        <th className="text-left px-4 py-3 font-semibold">Model</th>
                        <th className="text-left px-4 py-3 font-semibold">Provider</th>
                        <th className="text-right px-4 py-3 font-semibold">Input</th>
                        <th className="text-right px-4 py-3 font-semibold">Output</th>
                        <th className="text-right px-4 py-3 font-semibold">Cost</th>
                        <th className="text-right px-4 py-3 font-semibold">Latency</th>
                        <th className="text-center px-4 py-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((r) => (
                        <tr key={r.id} className="border-b border-border-light hover:bg-bg-row-hover transition-colors">
                          <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                            {new Date(r.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 font-medium text-text-primary font-mono text-xs">{r.model}</td>
                          <td className="px-4 py-3 text-text-secondary">{r.provider}</td>
                          <td className="px-4 py-3 text-right text-text-secondary">{formatNumber(r.inputTokens)}</td>
                          <td className="px-4 py-3 text-right text-text-secondary">{formatNumber(r.outputTokens)}</td>
                          <td className="px-4 py-3 text-right text-text-primary">${r.cost.toFixed(4)}</td>
                          <td className="px-4 py-3 text-right text-text-secondary">{r.latencyMs}ms</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`badge ${r.status === "success" ? "bg-accent-green/15 text-accent-green" : "bg-accent-red/15 text-accent-red"}`}>
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {nextCursor && (
                  <div className="text-center mt-4">
                    <button onClick={loadMore} className="btn-secondary">Load more</button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
