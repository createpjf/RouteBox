import { useState, useEffect } from "react";
import { Loader2, TrendingUp, Cpu, DollarSign, Crown, BarChart3, AlertCircle } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import clsx from "clsx";
import { api } from "@/lib/api";
import type { AnalyticsResponse } from "@/lib/api";
import { PROVIDER_COLORS, isRouteboxCloud } from "@/lib/constants";

type Period = "today" | "7d" | "30d";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
];

const EMPTY_DATA: AnalyticsResponse = {
  period: "today",
  timeSeries: [],
  providerBreakdown: [],
  topModels: [],
  totals: { requests: 0, tokens: 0, cost: 0, avgLatency: 0 },
};

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

function formatDateLabel(date: string): string {
  if (date.includes(" ")) return date.split(" ")[1];
  const parts = date.split("-");
  if (parts.length === 3) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[parseInt(parts[1], 10) - 1]} ${parseInt(parts[2], 10)}`;
  }
  return date;
}

function getProviderColor(name: string): string {
  return PROVIDER_COLORS[name] ?? "#86868B";
}

export function UsagePage() {
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
        const res = isRouteboxCloud()
          ? await api.cloudGetAnalytics(period)
          : await api.getAnalytics(period);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [period]);

  const display = data ?? EMPTY_DATA;

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

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-red/8">
          <AlertCircle size={12} strokeWidth={1.75} className="text-accent-red shrink-0" />
          <p className="text-[11px] text-accent-red">{error}</p>
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} strokeWidth={1.75} className="animate-spin text-[#AEAEB2]" />
        </div>
      ) : (
        <>
          {/* Summary Cards — 2×2 */}
          <div className="grid grid-cols-2 gap-2">
            <SummaryCard icon={TrendingUp} label="Requests" value={display.totals.requests.toLocaleString()} color="#00e5ff" />
            <SummaryCard icon={DollarSign} label="Cost" value={formatCost(display.totals.cost)} color="#34C759" />
            <SummaryCard icon={Cpu} label="Tokens" value={formatTokens(display.totals.tokens)} color="#FFD60A" />
            <SummaryCard
              icon={BarChart3}
              label="Models"
              value={String(display.topModels.length)}
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
            {display.timeSeries.length === 0 ? (
              <div className="flex items-center justify-center h-[100px]">
                <p className="text-[11px] text-text-tertiary">No data for this period</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={100}>
                <AreaChart data={display.timeSeries} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
                  <defs>
                    <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34C759" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#34C759" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" hide />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={formatDateLabel}
                    labelStyle={{ fontSize: "10px", color: "#86868B", marginBottom: "2px" }}
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

          {/* Top Models */}
          <div className="glass-card-static overflow-hidden">
            <div className="flex items-center gap-2 px-4 pt-3 pb-2">
              <TrendingUp size={13} strokeWidth={1.75} className="text-[#AEAEB2]" />
              <span className="text-[11px] font-medium text-[#86868B] tracking-[0.03em]">
                Top Models
              </span>
            </div>
            {display.topModels.length === 0 ? (
              <div className="px-4 pb-3">
                <p className="text-[11px] text-text-tertiary">
                  Send requests through RouteBox to see model usage
                </p>
              </div>
            ) : (
              display.topModels.map((m, i) => {
                const totalReqs = display.totals.requests || 1;
                const pct = Math.round((m.requests / totalReqs) * 100);
                return (
                  <div
                    key={m.model}
                    className={clsx(
                      "px-4 py-2",
                      i < display.topModels.length - 1 && "border-b border-border-light"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-medium text-[#1D1D1F] truncate max-w-[180px]">
                        {m.model}
                      </span>
                      <span className="text-[10px] text-[#86868B]">
                        {m.requests} req · {formatCost(m.cost)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#F2F2F7] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max(pct, 2)}%`,
                          backgroundColor: getProviderColor(m.model.split("/")[0] || m.model),
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pro upsell */}
          {isRouteboxCloud() && display.totals.cost > 0 && (
            <div
              className="rounded-xl p-3 cursor-pointer transition-all hover:scale-[1.005] active:scale-[0.995]"
              style={{
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                boxShadow: "0 4px 15px rgba(102, 126, 234, 0.25)",
              }}
              onClick={() => {
                api.cloudGetPlans().then(plans => {
                  const pro = plans.plans?.find((p: any) => p.id === "pro");
                  if (pro?.checkoutUrl) window.open(pro.checkoutUrl, "_blank");
                }).catch(() => {
                  window.open("https://routebox.dev/pricing", "_blank");
                });
              }}
            >
              <div className="flex items-center gap-2">
                <Crown size={16} strokeWidth={2} className="text-yellow-300 shrink-0" />
                <div className="flex-1">
                  <p className="text-[12px] font-bold text-white">Save 60% with Pro</p>
                  <p className="text-[10px] text-white/75">
                    25% markup → 10%. Upgrade for $9.90/mo.
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
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
