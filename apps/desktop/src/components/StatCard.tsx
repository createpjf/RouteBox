import type { ReactNode } from "react";
import clsx from "clsx";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  color: string;
  delta?: number;
  deltaInvert?: boolean;
  subtitle?: string;
}

export function StatCard({ label, value, icon, color, delta, deltaInvert, subtitle }: StatCardProps) {
  const isPositive = delta !== undefined && delta > 0;
  const deltaColor = deltaInvert
    ? isPositive ? "text-accent-red" : "text-accent-green"
    : isPositive ? "text-accent-green" : "text-accent-red";

  return (
    <div className="glass-card-static rounded-xl p-3 flex items-start justify-between">
      {/* Left: label → value → delta, all left-aligned in a stack */}
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-text-secondary leading-none">
          {label}
        </div>
        <div className="text-[18px] font-semibold text-text-primary tabular-nums tracking-[-0.02em] leading-none mt-1.5">
          {value}
        </div>
        {(delta !== undefined && delta !== 0 || subtitle) && (
          <div className="mt-0.5">
            {delta !== undefined && delta !== 0 && (
              <span className={clsx("text-[10px] font-medium tabular-nums leading-none", deltaColor)}>
                {isPositive ? "+" : ""}{delta}%
              </span>
            )}
            {subtitle && (
              <span className="text-[10px] text-text-tertiary leading-none">{subtitle}</span>
            )}
          </div>
        )}
      </div>
      {/* Right: icon, pinned top-right */}
      <div
        className="flex items-center justify-center h-7 w-7 rounded-lg shrink-0"
        style={{ backgroundColor: `${color}14`, color }}
      >
        {icon}
      </div>
    </div>
  );
}
