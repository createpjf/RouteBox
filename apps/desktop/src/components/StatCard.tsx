import type { ElementType } from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  color: string;
  icon: ElementType;
  delta?: number;
  deltaInvert?: boolean;
  subtitle?: string;
}

export function StatCard({ label, value, icon: Icon, delta, subtitle }: StatCardProps) {
  const isPositive = delta !== undefined && delta > 0;

  return (
    <div className="glass-card-static p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-bg-elevated">
          <Icon size={12} className="text-text-secondary" />
        </div>
        <span className="text-[11px] font-medium text-text-secondary tracking-[0.03em]">{label}</span>
      </div>
      <div>
        <span className="text-[24px] font-bold text-text-primary tabular-nums tracking-[-0.03em] leading-none">
          {value}
        </span>
        {(delta !== undefined && delta !== 0 || subtitle) && (
          <div className="mt-1">
            {delta !== undefined && delta !== 0 && (
              <span className="text-[10px] font-medium tabular-nums leading-none text-text-tertiary">
                {isPositive ? "+" : ""}{delta}%
              </span>
            )}
            {subtitle && (
              <span className="block text-[11px] text-text-tertiary mt-0.5">{subtitle}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
