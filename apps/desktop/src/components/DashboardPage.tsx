import { Zap, Coins, DollarSign, Sparkles } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { TrafficSparkline } from "@/components/TrafficSparkline";
import { BalanceCard } from "@/components/BalanceCard";
import { ProviderQuickList } from "@/components/ProviderQuickList";
import type { RealtimeStats, TrafficPoint } from "@/types/stats";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

interface DashboardPageProps {
  stats: RealtimeStats;
  history: TrafficPoint[];
}

export function DashboardPage({ stats, history }: DashboardPageProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 pt-2 gap-2.5">
      {/* Stats Grid */}
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

      {/* Traffic Sparkline — always visible */}
      <TrafficSparkline data={history} />

      {/* Balance — always visible */}
      <BalanceCard
        balance={stats.balance}
        budget={stats.budget}
        monthSpend={stats.monthSpend}
      />

      {/* Provider status */}
      <ProviderQuickList providers={stats.providers} />
    </div>
  );
}
