import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProviderStatus as ProviderStatusType } from "@/types/stats";
import { api, type ProviderModels } from "@/lib/api";
import { PROVIDER_COLORS } from "@/lib/constants";
import clsx from "clsx";

interface ProviderStatusProps {
  providers: ProviderStatusType[];
}

export function ProviderStatus({ providers }: ProviderStatusProps) {
  const [modelsMap, setModelsMap] = useState<Record<string, ProviderModels>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.getModels()
      .then((res) => {
        const map: Record<string, ProviderModels> = {};
        for (const pm of res.providers) map[pm.provider] = pm;
        setModelsMap(map);
      })
      .catch(() => {});
  }, [providers.length]);

  const toggle = (name: string) =>
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));

  return (
    <div>
      <h3 className="section-header">Providers</h3>
      {providers.length === 0 ? (
        <div className="glass-card-static p-3">
          <p className="text-[11px] text-text-tertiary text-center py-2">No providers configured</p>
        </div>
      ) : (
      <div className="glass-card-static overflow-hidden">
        {providers.map((p, i) => {
          const pm = modelsMap[p.name];
          const isExpanded = expanded[p.name] ?? false;
          const modelCount = pm?.models.length ?? 0;
          const color = PROVIDER_COLORS[p.name] ?? "#86868B";

          return (
            <div key={p.name}>
              <div
                className={clsx(
                  "flex items-center justify-between py-3 px-4 cursor-pointer hover:bg-[#FAFAFA] transition-colors",
                  !isExpanded && i < providers.length - 1 && "border-b border-border-light"
                )}
                onClick={() => toggle(p.name)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {isExpanded ? (
                    <ChevronDown size={13} strokeWidth={2} className="text-text-tertiary shrink-0" />
                  ) : (
                    <ChevronRight size={13} strokeWidth={2} className="text-text-tertiary shrink-0" />
                  )}
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: p.isUp ? color : "#C7C7CC" }}
                  />
                  <span className={clsx("text-[13px] font-medium", p.isUp ? "text-text-primary" : "text-text-tertiary")}>
                    {p.name}
                  </span>
                  {modelCount > 0 && (
                    <span className="text-[10px] text-text-tertiary bg-bg-input px-1.5 py-0.5 rounded-md">
                      {modelCount} models
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-text-tertiary">
                    {p.isUp ? `${p.latency}ms` : "offline"}
                  </span>
                  <div
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: p.isUp ? "#34C759" : "#C7C7CC" }}
                  />
                </div>
              </div>

              {/* Model list */}
              {isExpanded && pm && pm.models.length > 0 && (
                <div className={clsx(
                  "px-4 pb-2.5",
                  i < providers.length - 1 && "border-b border-border-light"
                )}>
                  {pm.models.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between py-1.5 px-2"
                    >
                      <span className="text-[11px] font-mono text-text-secondary truncate">
                        {m.id}
                      </span>
                      <span className="text-[10px] text-text-tertiary shrink-0 ml-2">
                        ${m.pricing.input}/{m.pricing.output}
                      </span>
                    </div>
                  ))}
                  <p className="text-[9px] text-text-tertiary mt-1 px-2">
                    price per 1M tokens (input/output)
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
