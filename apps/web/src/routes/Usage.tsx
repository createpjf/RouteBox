import { useState, useEffect, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import * as api from "@/lib/api";

const PERIOD_OPTIONS = [
  { value: "today" as const, label: "Today" },
  { value: "7d" as const, label: "7 Days" },
  { value: "30d" as const, label: "30 Days" },
];

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
  const [modelFilter, setModelFilter] = useState("all");

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

  // Get unique models for filter
  const models = [...new Set(requests.map((r) => r.model))];
  const filteredRequests = modelFilter === "all"
    ? requests
    : requests.filter((r) => r.model === modelFilter);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5">
          <div className="text-xs text-text-tertiary uppercase tracking-wider">Requests</div>
          <div className="text-2xl font-bold text-text-primary mt-1">{formatNumber(totals?.requests || 0)}</div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-text-tertiary uppercase tracking-wider">Tokens</div>
          <div className="text-2xl font-bold text-text-primary mt-1">{formatNumber(totals?.tokens || 0)}</div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-text-tertiary uppercase tracking-wider">Cost</div>
          <div className="text-2xl font-bold text-accent-ember mt-1">${(totals?.cost || 0).toFixed(4)}</div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-text-tertiary uppercase tracking-wider">Avg Latency</div>
          <div className="text-2xl font-bold text-text-primary mt-1">{totals?.avgLatency ? `${Math.round(totals.avgLatency)}ms` : "—"}</div>
        </div>
      </div>

      {/* Cost Chart */}
      {analytics && analytics.timeSeries.length > 0 && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-text-primary">Cost Trend</h2>
            <div className="flex gap-1 bg-bg-elevated border border-border rounded-lg p-0.5">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPeriod(opt.value)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
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
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={analytics.timeSeries}>
              <defs>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ff4d00" stopOpacity={0.2} />
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

      {/* Usage Details Table */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-text-primary">Usage Details</h2>
          <div className="flex gap-2">
            <select
              className="input h-8 text-xs w-auto pr-8"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
            >
              <option value="all">All Models</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <div key={i} className="h-10 skeleton rounded-lg" />)}
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="text-center py-8 text-text-secondary text-sm">No usage records.</div>
        ) : (
          <>
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
                    <th className="text-center px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((r) => (
                    <tr key={r.id} className="border-b border-border-light hover:bg-bg-row-hover transition-colors">
                      <td className="px-4 py-3 text-text-secondary text-xs whitespace-nowrap">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-text-primary">{r.model}</td>
                      <td className="px-4 py-3 text-right text-text-secondary">{formatNumber(r.inputTokens)}</td>
                      <td className="px-4 py-3 text-right text-text-secondary">{formatNumber(r.outputTokens)}</td>
                      <td className="px-4 py-3 text-right text-text-primary font-medium">${r.cost.toFixed(4)}</td>
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
                <button onClick={loadMore} className="btn-secondary text-sm">Load more</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
