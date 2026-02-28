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
    <div className="glass-card-static p-4 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#F5F5F7]">
          <Icon size={14} className="text-[#86868B]" />
        </div>
        <span className="text-[11px] font-medium text-[#86868B] tracking-[0.03em]">{label}</span>
      </div>
      <div>
        <span className="text-[28px] font-bold text-[#1D1D1F] tabular-nums tracking-[-0.03em] leading-none">
          {value}
        </span>
        {(delta !== undefined && delta !== 0 || subtitle) && (
          <div className="mt-1">
            {delta !== undefined && delta !== 0 && (
              <span className="text-[10px] font-medium tabular-nums leading-none text-[#AEAEB2]">
                {isPositive ? "+" : ""}{delta}%
              </span>
            )}
            {subtitle && (
              <span className="block text-[11px] text-[#C7C7CC] mt-0.5">{subtitle}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
