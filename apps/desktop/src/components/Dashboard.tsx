import { useState, useCallback, useEffect } from "react";
import { Activity, Zap, DollarSign, PiggyBank, Copy, Check, Pause, Play } from "lucide-react";
import { Header } from "@/components/Header";
import { StatCard } from "@/components/StatCard";
import { ProviderStatus } from "@/components/ProviderStatus";
import { TrafficSparkline } from "@/components/TrafficSparkline";
import { RequestLog } from "@/components/RequestLog";
import { RoutingStrategy } from "@/components/RoutingStrategy";
import { AlertBanner } from "@/components/AlertBanner";
import { BalanceCard } from "@/components/BalanceCard";
import { ToastContainer } from "@/components/ToastContainer";
import { Footer } from "@/components/Footer";
import { useRealtimeStats } from "@/hooks/useRealtimeStats";
import { useToast } from "@/hooks/useToast";
import { api } from "@/lib/api";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

interface DashboardProps {
  onOpenSettings: () => void;
}

export function Dashboard({ onOpenSettings }: DashboardProps) {
  const { stats, connected, stale, history, requestLog, alert, dismissAlert } = useRealtimeStats();
  const { toasts, showToast, dismissToast } = useToast();
  const [isPaused, setIsPaused] = useState(false);
  const [routingStrategy, setRoutingStrategy] = useState("smart_auto");
  const [copied, setCopied] = useState(false);

  // Sync pause + routing state from gateway on mount
  useEffect(() => {
    api.getTrafficStatus()
      .then((res) => setIsPaused(res.paused))
      .catch(() => {});
    api.getRouting()
      .then((res) => setRoutingStrategy(res.current))
      .catch(() => {});
  }, []);

  const handleCopyKey = useCallback(async () => {
    try {
      const keysRes = await api.getKeys();
      const key = keysRes.keys[0]?.plainKey;
      if (!key) {
        showToast("No API key available");
        return;
      }
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("copy_to_clipboard", { text: key });
      } catch {
        await navigator.clipboard.writeText(key);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to copy key");
    }
  }, [showToast]);

  const handleTopUp = useCallback(() => {
    window.open("https://app.routebox.dev/dashboard/settings/billing", "_blank");
  }, []);

  const handleTogglePause = useCallback(async () => {
    try {
      if (isPaused) {
        await api.resumeTraffic();
      } else {
        await api.pauseTraffic();
      }
      setIsPaused(!isPaused);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to toggle traffic");
    }
  }, [isPaused, showToast]);

  const handleChangeStrategy = useCallback((strategyId: string) => {
    setRoutingStrategy(strategyId);
    api.setRouting(strategyId).catch((err) => {
      showToast(err instanceof Error ? err.message : "Failed to change routing");
    });
  }, [showToast]);

  if (!stats) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="relative flex flex-col h-full">
      <Header connected={connected} stale={stale} onOpenSettings={onOpenSettings} />
      {alert && (
        <AlertBanner
          title={alert.title}
          message={alert.message}
          onDismiss={dismissAlert}
        />
      )}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2">
          <StatCard
            label="Requests"
            value={formatNumber(stats.requests)}
            icon={<Activity size={14} strokeWidth={1.75} />}
            color="#3B82F6"
            delta={stats.requestsDelta}
          />
          <StatCard
            label="Tokens"
            value={formatTokens(stats.tokens)}
            icon={<Zap size={14} strokeWidth={1.75} />}
            color="#FBBF24"
            delta={stats.tokensDelta}
          />
          <StatCard
            label="Cost"
            value={`$${stats.cost.toFixed(2)}`}
            icon={<DollarSign size={14} strokeWidth={1.75} />}
            color="#34D399"
            delta={stats.costDelta}
            deltaInvert
          />
          <StatCard
            label="Saved"
            value={`$${stats.saved.toFixed(2)}`}
            icon={<PiggyBank size={14} strokeWidth={1.75} />}
            color="#A78BFA"
            subtitle="by routing"
          />
        </div>

        {/* Traffic Sparkline */}
        <TrafficSparkline data={history} />

        {/* Provider Status */}
        <ProviderStatus providers={stats.providers} />

        {/* Request Log */}
        <RequestLog entries={requestLog} />

        {/* Quick Actions */}
        <div className="glass-card-static rounded-xl p-3">
          <h3 className="section-header">Quick Actions</h3>
          <div className="space-y-0.5">
            <button className="action-btn" onClick={handleCopyKey}>
              {copied ? (
                <Check size={14} strokeWidth={1.75} className="text-accent-green shrink-0" />
              ) : (
                <Copy size={14} strokeWidth={1.75} className="text-text-tertiary shrink-0" />
              )}
              <span className="flex-1 text-left text-[13px]">
                {copied ? "Copied!" : "Copy API Key"}
              </span>
              <kbd className="text-[10px] font-mono text-text-tertiary bg-white/[0.05] px-1.5 py-0.5 rounded-md border border-white/[0.06]">
                {"\u2318"}C
              </kbd>
            </button>

            <RoutingStrategy
              current={routingStrategy}
              onChange={handleChangeStrategy}
            />

            <button className="action-btn" onClick={handleTogglePause}>
              {isPaused ? (
                <Play size={14} strokeWidth={1.75} className="text-accent-green shrink-0" />
              ) : (
                <Pause size={14} strokeWidth={1.75} className="text-accent-amber shrink-0" />
              )}
              <span className="flex-1 text-left text-[13px]">
                {isPaused ? "Resume Traffic" : "Pause All Traffic"}
              </span>
              <kbd className="text-[10px] font-mono text-text-tertiary bg-white/[0.05] px-1.5 py-0.5 rounded-md border border-white/[0.06]">
                {"\u2318"}P
              </kbd>
            </button>
          </div>
        </div>

        {/* Balance */}
        <BalanceCard
          balance={stats.balance}
          onTopUp={handleTopUp}
        />
      </div>
      <Footer />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <div className="h-11 border-b border-border flex items-center px-4 shrink-0">
        <div className="skeleton h-4 w-20" />
      </div>
      <div className="flex-1 px-3 py-2.5 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card-static rounded-xl p-3">
              <div className="skeleton h-3 w-14 mb-2" />
              <div className="skeleton h-5 w-16" />
            </div>
          ))}
        </div>
        <div className="glass-card-static rounded-xl p-3">
          <div className="skeleton h-3 w-12 mb-2" />
          <div className="skeleton h-12 w-full" />
        </div>
        <div className="glass-card-static rounded-xl p-3">
          <div className="skeleton h-3 w-20 mb-2" />
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="skeleton h-1.5 w-1.5 rounded-full" />
                <div className="skeleton h-3 w-14" />
                <div className="flex-1" />
                <div className="skeleton h-3 w-10" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
