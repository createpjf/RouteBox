import { useState, useEffect, useCallback } from "react";
import { ChevronRight } from "lucide-react";
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
  const [toggles, setToggles] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    api.getModels()
      .then((res) => {
        const map: Record<string, ProviderModels> = {};
        for (const pm of res.providers) map[pm.provider] = pm;
        setModelsMap(map);
      })
      .catch(() => {});
    api.getModelToggles()
      .then((res) => {
        const map = new Map<string, boolean>();
        for (const t of res.toggles) {
          map.set(`${t.provider}:${t.modelId}`, t.enabled);
        }
        setToggles(map);
      })
      .catch(() => {});
  }, [providers.length]);

  const toggle = (name: string) =>
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));

  const isModelEnabled = (provider: string, modelId: string): boolean => {
    return toggles.get(`${provider}:${modelId}`) ?? true;
  };

  const handleToggleModel = useCallback(async (provider: string, modelId: string) => {
    const key = `${provider}:${modelId}`;
    const currentEnabled = toggles.get(key) ?? true;
    const newEnabled = !currentEnabled;

    setToggles((prev) => new Map(prev).set(key, newEnabled));

    try {
      await api.setModelToggle(modelId, provider, newEnabled);
    } catch {
      setToggles((prev) => new Map(prev).set(key, currentEnabled));
    }
  }, [toggles]);

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
          const color = PROVIDER_COLORS[p.name] ?? "#666666";

          return (
            <div
              key={p.name}
              className={clsx(
                i < providers.length - 1 && "border-b border-border-light"
              )}
            >
              {/* Header row */}
              <div
                className="flex items-center justify-between py-3 px-4 cursor-pointer hover:bg-hover-overlay transition-colors"
                onClick={() => toggle(p.name)}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <ChevronRight
                    size={13}
                    strokeWidth={2}
                    className={clsx(
                      "text-text-tertiary shrink-0 transition-transform duration-200",
                      isExpanded && "rotate-90"
                    )}
                  />
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: p.isUp ? color : "var(--color-dot-offline)" }}
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
                    style={{ backgroundColor: p.isUp ? "#34C759" : "var(--color-dot-offline)" }}
                  />
                </div>
              </div>

              {/* Expandable model list with CSS grid transition */}
              <div
                className="grid transition-[grid-template-rows] duration-200 ease-out"
                style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
              >
                <div className="overflow-hidden min-h-0">
                  {pm && pm.models.length > 0 && (
                    <div className="px-4 pb-2.5">
                      {pm.models.map((m) => {
                        const enabled = isModelEnabled(p.name, m.id);
                        return (
                          <div
                            key={m.id}
                            className="flex items-center justify-between py-1.5 px-2"
                          >
                            <span className={clsx(
                              "text-[11px] font-mono truncate",
                              enabled ? "text-text-secondary" : "text-text-tertiary line-through"
                            )}>
                              {m.id}
                            </span>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="text-[10px] text-text-tertiary">
                                ${m.pricing.input}/{m.pricing.output}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleModel(p.name, m.id);
                                }}
                                className={clsx(
                                  "relative w-7 h-4 rounded-full transition-colors duration-200",
                                  enabled ? "bg-[#34C759]" : "bg-toggle-off"
                                )}
                              >
                                <div className={clsx(
                                  "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200",
                                  enabled ? "translate-x-3.5" : "translate-x-0.5"
                                )} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-[9px] text-text-tertiary mt-1 px-2">
                        price per 1M tokens (input/output)
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
