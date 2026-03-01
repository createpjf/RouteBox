import clsx from "clsx";
import { ROUTING_STRATEGIES } from "@/lib/constants";

interface RoutingStrategyProps {
  current: string;
  onChange: (strategyId: string) => void;
}

export function RoutingStrategy({ current, onChange }: RoutingStrategyProps) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {ROUTING_STRATEGIES.map((strategy) => (
        <button
          key={strategy.id}
          onClick={() => onChange(strategy.id)}
          className={clsx(
            "flex flex-col items-start p-2.5 rounded-xl text-left transition-all duration-150",
            strategy.id === current
              ? "bg-accent-cyan/8 ring-1 ring-accent-cyan/30"
              : "hover:bg-[#F2F2F7]"
          )}
        >
          <div className="flex items-center gap-1.5">
            {strategy.id === current && (
              <div className="h-1.5 w-1.5 rounded-full bg-accent-cyan shrink-0" />
            )}
            <span
              className={clsx(
                "text-[12px] font-medium",
                strategy.id === current ? "text-accent-cyan" : "text-text-primary"
              )}
            >
              {strategy.name}
            </span>
          </div>
          <p className="text-[10px] text-text-tertiary mt-0.5 leading-tight">
            {strategy.description}
          </p>
        </button>
      ))}
    </div>
  );
}
