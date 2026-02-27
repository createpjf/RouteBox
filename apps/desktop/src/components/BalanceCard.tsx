import clsx from "clsx";
import { Wallet } from "lucide-react";

interface BalanceCardProps {
  balance: number;
  lowThreshold?: number;
  onTopUp: () => void;
}

export function BalanceCard({ balance, lowThreshold = 5, onTopUp }: BalanceCardProps) {
  const isLow = balance < lowThreshold;

  return (
    <div className="glass-card-static rounded-xl p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-white/[0.05]">
            <Wallet size={14} strokeWidth={1.75} className="text-text-secondary" />
          </div>
          <div>
            <span className="text-[11px] text-text-secondary block">Credits</span>
            <p
              className={clsx(
                "text-[18px] font-semibold tabular-nums tracking-[-0.02em] mt-0.5",
                isLow ? "text-accent-red" : "text-text-primary"
              )}
            >
              ${balance.toFixed(2)}
            </p>
          </div>
        </div>
        <button
          onClick={onTopUp}
          className="text-[13px] font-medium bg-accent-blue/10 hover:bg-accent-blue/18 text-accent-blue h-8 px-3.5 rounded-lg transition-colors"
        >
          Top Up
        </button>
      </div>
    </div>
  );
}
