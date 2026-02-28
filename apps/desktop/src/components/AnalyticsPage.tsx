import { useState, useEffect } from "react";
import { BarChart3, Loader2, TrendingUp, Cpu, DollarSign, Clock } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import clsx from "clsx";
import { api } from "@/lib/api";
import type { AnalyticsResponse } from "@/lib/api";
import { PROVIDER_COLORS } from "@/lib/constants";

type Period = "today" | "7d" | "30d";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
];

function getProviderColor(name: string): string {
  return PROVIDER_COLORS[name] ?? "#86868B";
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

const tooltipStyle = {
  background: "#FFFFFF",
  border: "0.5px solid rgba(0, 0, 0, 0.08)",
  borderRadius: "8px",
  fontSize: "11px",
  fontFamily: "var(--font-sans)",
  color: "#1D1D1F",
  padding: "4px 8px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
};

export function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("today");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await api.getAnalytics(period);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [period]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-5 pt-2 gap-3">
      {/* Period Selector */}
      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#F2F2F7]">
        {PERIODS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setPeriod(id)}
            className={clsx(
              "flex-1 text-[11px] font-medium py-1.5 rounded-md transition-all",
              period === id
                ? "bg-[#1D1D1F] text-white shadow-sm"
                : "text-[#86868B] hover:text-[#1D1D1F]"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} strokeWidth={1.75} className="animate-spin text-[#AEAEB2]" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-[11px] text-accent-red">{error}</p>
        </div>
      ) : data ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-2">
            <SummaryCard
              icon={TrendingUp}
              label="Requests"
              value={data.totals.requests.toLocaleString()}
              color="#00e5ff"
            />
            <SummaryCard
              icon={Cpu}
              label="Tokens"
              value={formatTokens(data.totals.tokens)}
              color="#FFD60A"
            />
            <SummaryCard
              icon={DollarSign}
              label="Cost"
              value={formatCost(data.totals.cost)}
              color="#34C759"
            />
            <SummaryCard
              icon={Clock}
              label="Avg Latency"
              value={data.totals.avgLatency > 0 ? `${(data.totals.avgLatency / 1000).toFixed(1)}s` : "—"}
              color="#BF5AF2"
            />
          </div>

          {/* Cost Over Time */}
          <div className="glass-card-static p-4">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={13} strokeWidth={1.75} className="text-[#AEAEB2]" />
              <span className="text-[11px] font-medium text-[#86868B] tracking-[0.03em]">
                Cost Over Time
              </span>
            </div>
            {data.timeSeries.length === 0 ? (
              <div className="flex items-center justify-center h-[100px]">
                <p className="text-[11px] text-text-tertiary">No data for this period</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={100}>
                <AreaChart data={data.timeSeries} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                  <defs>
                    <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34C759" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#34C759" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" hide />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ display: "none" }}
                    formatter={(value: number) => [formatCost(value), "Cost"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="cost"
                    stroke="#34C759"
                    fill="url(#costGrad)"
                    strokeWidth={1.8}
                    dot={false}
                    activeDot={{ r: 3, fill: "#34C759", strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Token Usage */}
          <div className="glass-card-static p-4">
            <div className="flex items-center gap-2 mb-3">
              <Cpu size={13} strokeWidth={1.75} className="text-[#AEAEB2]" />
              <span className="text-[11px] font-medium text-[#86868B] tracking-[0.03em]">
                Token Usage
              </span>
            </div>
            {data.timeSeries.length === 0 ? (
              <div className="flex items-center justify-center h-[100px]">
                <p className="text-[11px] text-text-tertiary">No data for this period</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={100}>
                <AreaChart data={data.timeSeries} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                  <defs>
                    <linearGradient id="inputGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#007AFF" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#007AFF" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="outputGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF9500" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#FF9500" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" hide />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ display: "none" }}
                    formatter={(value: number, name: string) => [
                      formatTokens(value),
                      name === "inputTokens" ? "Input" : "Output",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="inputTokens"
                    stroke="#007AFF"
                    fill="url(#inputGrad)"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 2.5, fill: "#007AFF", strokeWidth: 0 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="outputTokens"
                    stroke="#FF9500"
                    fill="url(#outputGrad)"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 2.5, fill: "#FF9500", strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-[#007AFF]" />
                <span className="text-[10px] text-[#86868B]">Input</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-[#FF9500]" />
                <span className="text-[10px] text-[#86868B]">Output</span>
              </div>
            </div>
          </div>

          {/* Provider Breakdown */}
          {data.providerBreakdown.length > 0 && (
            <div className="glass-card-static p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={13} strokeWidth={1.75} className="text-[#AEAEB2]" />
                <span className="text-[11px] font-medium text-[#86868B] tracking-[0.03em]">
                  Provider Breakdown
                </span>
              </div>
              <div className="space-y-2">
                {data.providerBreakdown.map((p) => {
                  const totalReqs = data.totals.requests || 1;
                  const pct = Math.round((p.requests / totalReqs) * 100);
                  return (
                    <div key={p.provider} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-[#1D1D1F]">{p.provider}</span>
                        <span className="text-[10px] text-[#86868B]">
                          {p.requests} req · {formatCost(p.cost)} · {pct}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[#F2F2F7] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: getProviderColor(p.provider),
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top Models */}
          {data.topModels.length > 0 && (
            <div className="glass-card-static overflow-hidden">
              <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                <TrendingUp size={13} strokeWidth={1.75} className="text-[#AEAEB2]" />
                <span className="text-[11px] font-medium text-[#86868B] tracking-[0.03em]">
                  Top Models
                </span>
              </div>
              {data.topModels.map((m, i) => (
                <div
                  key={m.model}
                  className={clsx(
                    "flex items-center justify-between h-9 px-4",
                    i < data.topModels.length - 1 && "border-b border-border-light"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-[#C7C7CC] w-4">{i + 1}.</span>
                    <span className="text-[12px] font-medium text-[#1D1D1F] truncate max-w-[160px]">
                      {m.model}
                    </span>
                  </div>
                  <span className="text-[10px] text-[#86868B]">
                    {m.requests.toLocaleString()} req · {formatCost(m.cost)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {data.timeSeries.length === 0 && data.providerBreakdown.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <BarChart3 size={28} strokeWidth={1.2} className="text-[#C7C7CC]" />
              <p className="text-[12px] text-[#86868B]">No requests recorded yet</p>
              <p className="text-[10px] text-[#C7C7CC]">Send requests through RouteBox to see analytics</p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="glass-card-static p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Icon size={12} strokeWidth={1.75} style={{ color }} />
        <span className="text-[10px] font-medium text-[#86868B] tracking-[0.03em]">{label}</span>
      </div>
      <span className="text-[18px] font-semibold text-[#1D1D1F] tracking-tight">{value}</span>
    </div>
  );
}
