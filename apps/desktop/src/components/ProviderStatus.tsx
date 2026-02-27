import type { ProviderStatus as ProviderStatusType } from "@/types/stats";
import { PROVIDER_COLORS } from "@/lib/constants";
import clsx from "clsx";

interface ProviderStatusProps {
  providers: ProviderStatusType[];
}

export function ProviderStatus({ providers }: ProviderStatusProps) {
  return (
    <div className="glass-card-static rounded-xl p-3">
      <h3 className="section-header">Providers</h3>
      {providers.length === 0 ? (
        <p className="text-[11px] text-text-tertiary text-center py-3">No providers configured</p>
      ) : (
      <div className="space-y-0.5">
        {providers.map((p) => (
          <div
            key={p.name}
            className="flex items-center justify-between h-8 px-2 rounded-lg hover:bg-bg-row-hover transition-colors"
          >
            <div className="flex items-center gap-2">
              <div
                className={clsx(
                  "h-1.5 w-1.5 rounded-full shrink-0",
                  !p.isUp && "opacity-30"
                )}
                style={{
                  backgroundColor: p.isUp ? (PROVIDER_COLORS[p.name] || "#3B82F6") : "#F87171",
                }}
              />
              <span className={clsx("text-[13px]", p.isUp ? "text-text-primary" : "text-text-tertiary")}>
                {p.name}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-tertiary tabular-nums">
                {p.isUp ? `${p.latency}ms` : "timeout"}
              </span>
              <span
                className={clsx(
                  "badge",
                  p.keySource === "byok"
                    ? "bg-accent-green/10 text-accent-green"
                    : "bg-accent-blue/10 text-accent-blue"
                )}
              >
                {p.keySource === "byok" ? "BYOK" : "Pool"}
              </span>
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
