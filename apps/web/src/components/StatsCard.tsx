import { type ReactNode } from "react";
import clsx from "clsx";

interface StatsCardProps {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  trend?: "up" | "down" | "neutral";
  className?: string;
}

export function StatsCard({ label, value, sub, icon, trend, className }: StatsCardProps) {
  return (
    <div className={clsx("glass-card-static p-5", className)}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          {label}
        </span>
        {icon && <div className="text-text-tertiary">{icon}</div>}
      </div>
      <div className="text-2xl font-bold text-text-primary">{value}</div>
      {sub && (
        <div
          className={clsx("text-xs mt-1", {
            "text-accent-green": trend === "up",
            "text-accent-red": trend === "down",
            "text-text-tertiary": !trend || trend === "neutral",
          })}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
