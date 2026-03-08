import { useState, useEffect, useRef } from "react";
import { Zap, Coins, DollarSign, Sparkles, Loader2, AlertCircle, Crown, BarChart3 } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import clsx from "clsx";
import { StatCard } from "@/components/StatCard";
import { BalanceCard } from "@/components/BalanceCard";
import { ProviderQuickList } from "@/components/ProviderQuickList";
import { api } from "@/lib/api";
import type { AnalyticsResponse } from "@/lib/api";
import { PROVIDER_COLORS, getGatewayMode } from "@/lib/constants";
import type { RealtimeStats } from "@/types/stats";

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

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatCost(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

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
  return PROVIDER_COLORS[name] ?? "#666666";
}

const tooltipStyle = {
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  fontSize: "11px",
  fontFamily: "var(--font-sans)",
  color: "var(--color-text-primary)",
  padding: "4px 8px",
  boxShadow: "var(--shadow-elevated)",
};

interface HomePageProps {
  stats: RealtimeStats;
  ready?: boolean;
}

export function HomePage({ stats, ready = true }: HomePageProps) {
  const [period, setPeriod] = useState<Period>("today");
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!ready) return;
    // Increment sequence to ignore stale responses from previous period selections
    const seq = ++requestSeqRef.current;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = getGatewayMode() === "cloud"
          ? await api.cloudGetAnalytics(period)
          : await api.getAnalytics(period);
        if (seq === requestSeqRef.current) setData(res);
      } catch (err) {
        if (seq === requestSeqRef.current) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    }
    fetchData();
  }, [period, ready]);

  const display = data ?? EMPTY_DATA;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 pt-2 gap-2.5">
      {/* Realtime Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="Requests"
          value={formatNumber(stats.requests)}
          color="#00e5ff"
          icon={Zap}
          delta={stats.requestsDelta}
        />
        <StatCard
          label="Tokens"
          value={formatTokens(stats.tokens)}
          color="#FFD60A"
          icon={Coins}
          delta={stats.tokensDelta}
        />
        <StatCard
          label="Cost"
          value={`$${stats.cost.toFixed(2)}`}
          color="#34C759"
          icon={DollarSign}
          delta={stats.costDelta}
          deltaInvert
        />
        <StatCard
          label="Saved"
          value={`$${stats.saved.toFixed(2)}`}
          color="#BF5AF2"
          icon={Sparkles}
          subtitle="by routing"
        />
      </div>

      {/* Balance */}
      <BalanceCard
        balance={stats.balance}
        budget={stats.budget}
        monthSpend={stats.monthSpend}
      />

      {/* Historical Analytics Section */}
      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-elevated">
        {PERIODS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setPeriod(id)}
            className={clsx(
              "flex-1 text-[11px] font-medium py-1.5 rounded-md transition-all",
              period === id
                ? "bg-[#ff4d00] text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-accent-red/8">
          <AlertCircle size={12} strokeWidth={1.75} className="text-accent-red shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] text-accent-red">{error}</p>
            {getGatewayMode() === "local" && (
              <p className="text-[10px] text-text-secondary mt-0.5">
                Check that your local gateway is running.
              </p>
            )}
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={20} strokeWidth={1.75} className="animate-spin text-text-tertiary" />
        </div>
      ) : (
        <>
          {/* Cost Over Time */}
          <div className="glass-card-static p-4">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={13} strokeWidth={1.75} className="text-text-tertiary" />
              <span className="text-[11px] font-medium text-text-secondary tracking-[0.03em]">
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
                      <stop offset="0%" stopColor="#ff4d00" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#ff4d00" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" hide />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelFormatter={formatDateLabel}
                    labelStyle={{ fontSize: "10px", color: "var(--color-text-secondary)", marginBottom: "2px" }}
                    formatter={(value: number) => [formatCost(value), "Cost"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="cost"
                    stroke="#ff4d00"
                    fill="url(#costGrad)"
                    strokeWidth={1.8}
                    dot={false}
                    activeDot={{ r: 3, fill: "#ff4d00", strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top Models */}
          <div className="glass-card-static overflow-hidden">
            <div className="flex items-center gap-2 px-4 pt-3 pb-2">
              <BarChart3 size={13} strokeWidth={1.75} className="text-text-tertiary" />
              <span className="text-[11px] font-medium text-text-secondary tracking-[0.03em]">
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
                      <span className="text-[12px] font-medium text-text-primary truncate max-w-[180px]">
                        {m.model.replace(/^openrouter\//, "")}
                      </span>
                      <span className="text-[10px] text-text-secondary">
                        {m.requests} req · {formatCost(m.cost)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-progress-track overflow-hidden">
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
        </>
      )}

      {/* Provider status */}
      <ProviderQuickList providers={stats.providers} />

      {/* Pro upsell */}
      {getGatewayMode() === "cloud" && display.totals.cost > 0 && (
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
    </div>
  );
}
