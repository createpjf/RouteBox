import { useState, useRef, useEffect } from "react";
import clsx from "clsx";
import { ChevronDown, Check } from "lucide-react";
import { ROUTING_STRATEGIES } from "@/lib/constants";

interface RoutingStrategyProps {
  current: string;
  onChange: (strategyId: string) => void;
}

export function RoutingStrategy({ current, onChange }: RoutingStrategyProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentStrategy = ROUTING_STRATEGIES.find((s) => s.id === current) || ROUTING_STRATEGIES[0];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="action-btn justify-between"
      >
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 rounded-full bg-accent-cyan shrink-0" />
          <span className="text-[13px] text-text-primary">
            Strategy: <span className="text-accent-cyan font-medium">{currentStrategy.name}</span>
          </span>
        </div>
        <ChevronDown
          size={12}
          strokeWidth={1.75}
          className={clsx(
            "text-text-tertiary transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 elevated overflow-hidden animate-dropdown-in">
          {ROUTING_STRATEGIES.map((strategy) => (
            <button
              key={strategy.id}
              onClick={() => {
                onChange(strategy.id);
                setOpen(false);
              }}
              className={clsx(
                "flex items-center gap-2 w-full px-3 py-2 text-left transition-colors",
                strategy.id === current
                  ? "bg-accent-cyan/8"
                  : "hover:bg-bg-card"
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-text-primary font-medium">{strategy.name}</p>
                <p className="text-[10px] text-text-tertiary mt-0.5">{strategy.description}</p>
              </div>
              {strategy.id === current && (
                <Check size={14} strokeWidth={1.75} className="text-accent-cyan shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
