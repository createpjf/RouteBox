import { Wallet } from "lucide-react";
import clsx from "clsx";

interface BalanceCardProps {
  balance: number;
  budget?: number;
  monthSpend?: number;
  lowThreshold?: number;
  onTopUp?: () => void;
}

export function BalanceCard({ budget = 0, monthSpend = 0 }: BalanceCardProps) {
  const hasBudget = budget > 0;
  const pct = hasBudget && Number.isFinite(monthSpend) && Number.isFinite(budget)
    ? Math.min(100, Math.round((monthSpend / budget) * 100))
    : 0;

  const hasUsage = monthSpend > 0;

  return (
    <div className="glass-card-static p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-bg-elevated">
            <Wallet size={14} strokeWidth={1.8} className="text-text-secondary" />
          </div>
          <div>
            <span className="text-[11px] text-text-secondary block font-medium">Total Cost</span>
            {hasUsage ? (
              <span className="text-[20px] font-bold tabular-nums tracking-[-0.03em] text-text-primary">
                ${monthSpend.toFixed(2)}
              </span>
            ) : (
              <span className="text-[14px] font-medium text-text-secondary">
                No usage yet
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] text-text-secondary font-medium px-2 py-1 rounded-lg bg-bg-elevated">
          BYOK
        </span>
      </div>

      {hasBudget && (
        <div className="mt-3 pt-3 border-t border-border-light">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-text-secondary">Monthly Budget</span>
            <span className="text-[10px] tabular-nums text-text-secondary">
              ${monthSpend.toFixed(2)} / ${budget.toFixed(2)}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-progress-track overflow-hidden">
            <div
              className={clsx(
                "h-full rounded-full transition-all duration-500",
                pct >= 80 ? "bg-[#FF3B30]" : pct >= 60 ? "bg-[#FF9500]" : "bg-[#34C759]"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-end mt-1">
            <span
              className={clsx(
                "text-[9px] font-medium",
                pct >= 80 ? "text-[#FF3B30]" : pct >= 60 ? "text-[#FF9500]" : "text-[#34C759]"
              )}
            >
              {pct}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
