import { Zap } from "lucide-react";
import type { ProviderStatus } from "@/types/stats";
import { PROVIDER_COLORS } from "@/lib/constants";

interface ProviderQuickListProps {
  providers: ProviderStatus[];
}

export function ProviderQuickList({ providers }: ProviderQuickListProps) {
  return (
    <div className="glass-card-static p-3">
      <div className="flex items-center gap-2 mb-2">
        <Zap size={12} strokeWidth={1.75} className="text-[#AEAEB2]" />
        <span className="text-[11px] font-medium text-[#86868B] tracking-[0.03em]">
          Providers
        </span>
      </div>
      {providers.length === 0 ? (
        <div className="flex items-center justify-center py-2">
          <p className="text-[11px] text-[#C7C7CC]">No providers configured</p>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {providers.map((p) => {
            const color = PROVIDER_COLORS[p.name] ?? "#8E8E93";
            return (
              <div
                key={p.name}
                className="flex items-center justify-between h-7 px-1"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-[6px] h-[6px] rounded-full shrink-0"
                    style={{ backgroundColor: p.isUp ? color : "#C7C7CC" }}
                  />
                  <span className="text-[12px] text-[#1D1D1F] font-medium truncate">
                    {p.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px] tabular-nums text-[#86868B] w-12 text-right">
                    {p.isUp ? `${p.latency}ms` : "offline"}
                  </span>
                  <span className="text-[11px] tabular-nums text-[#AEAEB2] w-14 text-right">
                    {p.requestsToday} reqs
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
