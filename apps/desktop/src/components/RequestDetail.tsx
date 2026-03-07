import { X, ArrowRight, AlertTriangle } from "lucide-react";
import type { RequestLogEntry } from "@/types/stats";

interface RequestDetailProps {
  entry: RequestLogEntry;
  onClose: () => void;
}

const STATUS_INFO = {
  success: { bg: "rgba(52,199,89,0.08)", color: "#34C759", label: "Success" },
  error: { bg: "rgba(255,59,48,0.08)", color: "#FF3B30", label: "Error" },
  fallback: { bg: "rgba(255,159,10,0.08)", color: "#FF9F0A", label: "Fallback" },
} as const;

const STRATEGY_NAMES: Record<string, string> = {
  smart_auto: "Smart Auto",
  cost_first: "Cost First",
  speed_first: "Speed First",
  quality_first: "Quality First",
};

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function formatCost(cost: number): string {
  if (cost >= 0.01) return `$${cost.toFixed(4)}`;
  if (cost > 0) return `$${cost.toFixed(6)}`;
  return "—";
}

function formatTokens(n: number | undefined): string {
  if (!n) return "—";
  return n.toLocaleString();
}

export function RequestDetail({ entry, onClose }: RequestDetailProps) {
  const badge = STATUS_INFO[entry.status];
  const hasRouting = entry.requestedModel && entry.requestedModel !== entry.model;

  return (
    <div className="absolute inset-0 z-30 flex flex-col">
      {/* Backdrop */}
      <div
        className="flex-1 min-h-[35%]"
        style={{ background: "rgba(0,0,0,0.3)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <div className="glass-card rounded-b-none animate-slide-up flex flex-col max-h-[65%]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-11 border-b border-border-light shrink-0">
          <h2 className="text-[14px] font-semibold text-text-primary">Request Detail</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg-card transition-colors"
          >
            <X size={14} strokeWidth={1.75} className="text-text-tertiary" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* Status + Time */}
          <div className="flex items-center gap-2.5">
            <span
              className="text-[12px] font-semibold px-2 py-0.5 rounded-md"
              style={{ background: badge.bg, color: badge.color }}
            >
              {badge.label}
            </span>
            <span className="text-[12px] font-mono text-text-tertiary">
              {formatTimestamp(entry.timestamp)}
            </span>
          </div>

          {/* Routing section */}
          <div>
            <h3 className="section-header">Routing</h3>
            <div className="glass-card-static overflow-hidden">
              <DetailRow label="Provider" value={entry.provider} />
              <DetailRow label="Model" value={entry.model} />
              {hasRouting && (
                <DetailRow
                  label="Requested"
                  value={
                    <span className="flex items-center gap-1.5">
                      <span className="text-text-tertiary">{entry.requestedModel}</span>
                      <ArrowRight size={10} strokeWidth={1.75} className="text-text-tertiary" />
                      <span className="text-text-primary">{entry.model}</span>
                    </span>
                  }
                />
              )}
              {entry.routingStrategy && (
                <DetailRow
                  label="Strategy"
                  value={STRATEGY_NAMES[entry.routingStrategy] || entry.routingStrategy}
                />
              )}
              {entry.isFallback && (
                <DetailRow
                  label="Fallback"
                  value={
                    <span className="flex items-center gap-1 text-accent-amber">
                      <AlertTriangle size={12} strokeWidth={1.75} />
                      Yes
                    </span>
                  }
                />
              )}
            </div>
          </div>

          {/* Usage section */}
          <div>
            <h3 className="section-header">Usage</h3>
            <div className="glass-card-static overflow-hidden">
              <DetailRow label="Input tokens" value={formatTokens(entry.inputTokens)} mono />
              <DetailRow label="Output tokens" value={formatTokens(entry.outputTokens)} mono />
              <DetailRow
                label="Total tokens"
                value={formatTokens(entry.tokens > 0 ? entry.tokens : undefined)}
                mono
                last
              />
            </div>
          </div>

          {/* Performance section */}
          <div>
            <h3 className="section-header">Performance</h3>
            <div className="glass-card-static overflow-hidden">
              <DetailRow label="Latency" value={formatLatency(entry.latencyMs)} mono />
              <DetailRow label="Cost" value={formatCost(entry.cost)} mono last />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  last = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between h-9 px-3 ${
        !last ? "border-b border-border-light" : ""
      }`}
    >
      <span className="text-[12px] text-text-secondary">{label}</span>
      <span
        className={`text-[12px] text-text-primary ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
