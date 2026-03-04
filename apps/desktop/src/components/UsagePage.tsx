import { useState, useEffect } from "react";
import { Loader2, DollarSign, Zap, TrendingDown, Lightbulb } from "lucide-react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { api } from "@/lib/api";
import type { UsageTodayResponse, UsageMonthResponse, WeeklyTrendRow, ModelBreakdownRow, UsageSuggestion } from "@/lib/api";

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

const MODEL_COLORS = [
  "#34C759", "#007AFF", "#FF9500", "#AF52DE", "#FF3B30",
  "#5AC8FA", "#FFCC00", "#FF2D55", "#64D2FF", "#30D158",
];

export function UsagePage() {
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<UsageTodayResponse | null>(null);
  const [month, setMonth] = useState<UsageMonthResponse | null>(null);
  const [weekly, setWeekly] = useState<WeeklyTrendRow[]>([]);
  const [models, setModels] = useState<ModelBreakdownRow[]>([]);
  const [suggestions, setSuggestions] = useState<UsageSuggestion[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [t, m, w, md, s] = await Promise.all([
          api.getUsageToday(),
          api.getUsageMonth(),
          api.getUsageWeekly(),
          api.getUsageModels(),
          api.getUsageSuggestions(),
        ]);
        setToday(t);
        setMonth(m);
        setWeekly(w);
        setModels(md);
        setSuggestions(s);
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin" size={20} style={{ color: "#AEAEB2" }} />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={<DollarSign size={14} />}
          label="Today"
          value={formatCost(today?.cost ?? 0)}
          sub={`${today?.requests ?? 0} requests`}
        />
        <StatCard
          icon={<Zap size={14} />}
          label="This Month"
          value={formatCost(month?.cost ?? 0)}
          sub={month?.budgetPct ? `${month.budgetPct}% of budget` : "No budget set"}
        />
        <StatCard
          icon={<TrendingDown size={14} />}
          label="Saved"
          value={formatCost(today?.saved ?? 0)}
          sub="by routing"
        />
      </div>

      {/* 7-day trend chart */}
      <div className="glass-card p-3">
        <div className="text-xs font-medium mb-2" style={{ color: "#86868B" }}>
          7-Day Cost Trend
        </div>
        <div style={{ height: 140 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weekly}>
              <defs>
                <linearGradient id="usageCostGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34C759" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#34C759" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => {
                  const parts = d.split("-");
                  return `${parts[1]}/${parts[2]}`;
                }}
                tick={{ fontSize: 9, fill: "#AEAEB2" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number) => [formatCost(value), "Cost"]}
              />
              <Area
                type="monotone"
                dataKey="cost"
                stroke="#34C759"
                strokeWidth={2}
                fill="url(#usageCostGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Model breakdown */}
      <div className="glass-card p-3">
        <div className="text-xs font-medium mb-2" style={{ color: "#86868B" }}>
          Model Breakdown
        </div>
        {models.length === 0 ? (
          <div className="text-xs" style={{ color: "#AEAEB2" }}>No data yet</div>
        ) : (
          <div className="space-y-2">
            {models.map((m, i) => (
              <div key={m.model} className="flex items-center gap-2">
                <div
                  className="text-xs truncate"
                  style={{ width: 100, color: "#1D1D1F", fontWeight: 500 }}
                >
                  {m.model}
                </div>
                <div className="flex-1 h-4 rounded" style={{ background: "rgba(0,0,0,0.04)" }}>
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${Math.max(m.pct, 2)}%`,
                      background: MODEL_COLORS[i % MODEL_COLORS.length],
                      opacity: 0.7,
                    }}
                  />
                </div>
                <div
                  className="text-xs text-right"
                  style={{ width: 50, color: "#86868B" }}
                >
                  {formatCost(m.cost)}
                </div>
                <div
                  className="text-xs text-right"
                  style={{ width: 30, color: "#AEAEB2" }}
                >
                  {m.pct}%
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cost tips */}
      {suggestions.length > 0 && (
        <div className="glass-card p-3">
          <div className="flex items-center gap-1 text-xs font-medium mb-2" style={{ color: "#86868B" }}>
            <Lightbulb size={12} /> Tips
          </div>
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <div
                key={i}
                className="text-xs p-2 rounded-lg"
                style={{
                  background: "rgba(52, 199, 89, 0.06)",
                  color: "#1D1D1F",
                }}
              >
                {s.message}
                {s.savingsEstimate && (
                  <span style={{ color: "#34C759", fontWeight: 600, marginLeft: 4 }}>
                    Save {s.savingsEstimate}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="glass-card p-3">
      <div className="flex items-center gap-1 text-[10px] mb-1" style={{ color: "#86868B" }}>
        {icon} {label}
      </div>
      <div className="text-lg font-semibold" style={{ color: "#1D1D1F" }}>
        {value}
      </div>
      <div className="text-[10px]" style={{ color: "#AEAEB2" }}>
        {sub}
      </div>
    </div>
  );
}
