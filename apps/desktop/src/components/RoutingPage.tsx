import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Copy, Check, Pause, Play, Plus, X, Pin, Ban, Loader2, Search, ChevronDown, Pencil } from "lucide-react";
import clsx from "clsx";
import { ProviderStatus } from "@/components/ProviderStatus";
import { RoutingStrategy } from "@/components/RoutingStrategy";
import { api } from "@/lib/api";
import type { ModelPreference, RoutingRule, CloudRegistryModel, CloudModelEntry } from "@/lib/api";
import type { RealtimeStats } from "@/types/stats";
import { getGatewayMode, setRoutingStrategy as setRoutingStrategyModule, setRoutingRules as setRoutingRulesModule } from "@/lib/constants";

interface RoutingPageProps {
  stats: RealtimeStats;
  showToast: (msg: string) => void;
  ready?: boolean;
}

/** Reverse index: modelId → [{provider, pricing}] */
interface ModelProviderEntry {
  provider: string;
  pricing: { input: number; output: number };
}

export function RoutingPage({ stats, showToast, ready }: RoutingPageProps) {
  const isCloud = getGatewayMode() === "cloud";
  const [isPaused, setIsPaused] = useState(false);
  const [routingStrategy, setRoutingStrategy] = useState("smart_auto");
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [preferences, setPreferences] = useState<ModelPreference[]>([]);
  const [showAddPref, setShowAddPref] = useState(false);
  const [prefAction, setPrefAction] = useState<"pin" | "exclude">("pin");
  const [prefSaving, setPrefSaving] = useState(false);

  const [routingRules, setRoutingRules] = useState<RoutingRule[]>([]);
  const [showAddRule, setShowAddRule] = useState(false);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleMatchType, setRuleMatchType] = useState<RoutingRule["matchType"]>("content_code");
  const [ruleMatchValue, setRuleMatchValue] = useState("");
  const [ruleTargetModel, setRuleTargetModel] = useState("");
  const [ruleSearchQuery, setRuleSearchQuery] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);

  const [modelIndex, setModelIndex] = useState<Map<string, ModelProviderEntry[]>>(new Map());
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsError, setModelsError] = useState(false);
  const [cloudModels, setCloudModels] = useState<CloudModelEntry[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [registryModels, setRegistryModels] = useState<CloudRegistryModel[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");

  useEffect(() => {
    if (isCloud || !ready) return;
    api.getTrafficStatus()
      .then((res) => setIsPaused(res.paused))
      .catch(() => {});
    api.getRouting()
      .then((res) => setRoutingStrategy(res.current))
      .catch(() => {});
    api.getPreferences()
      .then((res) => setPreferences(res.preferences))
      .catch(() => {});
    api.getRoutingRules()
      .then((res) => setRoutingRules(res.rules))
      .catch(() => {});
  }, [isCloud, ready]);

  useEffect(() => {
    if (isCloud) return;
    api.getModels()
      .then((res) => {
        const idx = new Map<string, ModelProviderEntry[]>();
        for (const p of res.providers) {
          for (const m of p.models) {
            const existing = idx.get(m.id) || [];
            existing.push({ provider: p.provider, pricing: m.pricing });
            idx.set(m.id, existing);
          }
        }
        setModelIndex(idx);
        setModelsLoaded(true);
        setModelsError(false);
      })
      .catch(() => { setModelsError(true); setModelsLoaded(true); });
  }, [isCloud, stats.providers.length]);

  useEffect(() => {
    if (!isCloud || !ready) return;
    api.cloudGetModels()
      .then((res) => {
        const sorted = [...res.data].sort((a, b) => a.id.localeCompare(b.id));
        setCloudModels(sorted);
        // Build modelIndex for cloud rules target selector
        const idx = new Map<string, ModelProviderEntry[]>();
        for (const m of res.data) {
          idx.set(m.id, [{ provider: m.owned_by || "unknown", pricing: { input: 0, output: 0 } }]);
        }
        setModelIndex(idx);
        setModelsLoaded(true);
        setModelsError(false);
      })
      .catch(() => setModelsError(true));

    // Check admin status (retry once on failure)
    const checkAdmin = () =>
      api.cloudGetAccount()
        .then((res) => {
          if (res.isAdmin) {
            setIsAdmin(true);
            setRegistryLoading(true);
            // Load full registry for admin
            api.cloudAdminGetModels()
              .then((r) => setRegistryModels(r.models))
              .catch(() => {})
              .finally(() => setRegistryLoading(false));
          }
        });
    checkAdmin().catch(() => {
      // Retry once after 2s
      setTimeout(() => checkAdmin().catch(() => {}), 2000);
    });
  }, [isCloud, ready]);

  // Load cloud routing preferences from Tauri store
  useEffect(() => {
    if (!isCloud) return;
    import("@tauri-apps/plugin-store").then(({ load }) =>
      load("settings.json").then(async (store) => {
        const s = await store.get<string>("cloudRoutingStrategy");
        if (s) { setRoutingStrategy(s); setRoutingStrategyModule(s); }
        const r = await store.get<RoutingRule[]>("cloudRoutingRules");
        if (r) { setRoutingRules(r); setRoutingRulesModule(r.map(rule => ({ matchType: rule.matchType, matchValue: rule.matchValue, targetModel: rule.targetModel, enabled: rule.enabled, priority: rule.priority }))); }
      })
    ).catch(() => {});
  }, [isCloud]);

  const filteredModels = useMemo(() => {
    const allModels = Array.from(modelIndex.keys()).sort();
    if (!searchQuery.trim()) return allModels;
    const q = searchQuery.toLowerCase();
    return allModels.filter((m) => stripRouterPrefix(m).toLowerCase().includes(q) || m.toLowerCase().includes(q));
  }, [modelIndex, searchQuery]);

  const availableProviders = useMemo(() => {
    if (!selectedModel) return [];
    return modelIndex.get(selectedModel) || [];
  }, [modelIndex, selectedModel]);

  useEffect(() => {
    if (availableProviders.length === 1) {
      setSelectedProvider(availableProviders[0].provider);
    } else if (availableProviders.length > 0 && !availableProviders.find((p) => p.provider === selectedProvider)) {
      setSelectedProvider("");
    }
  }, [availableProviders, selectedProvider]);

  const handleCopyKey = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const key = await invoke<string>("get_token");
      if (!key) {
        showToast("No API key available");
        return;
      }
      try {
        await invoke("copy_to_clipboard", { text: key });
      } catch {
        await navigator.clipboard.writeText(key);
      }
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to copy key");
    }
  }, [showToast]);

  const handleTogglePause = useCallback(async () => {
    const prev = isPaused;
    setIsPaused(!prev);
    try {
      if (prev) {
        await api.resumeTraffic();
      } else {
        await api.pauseTraffic();
      }
    } catch (err) {
      setIsPaused(prev);
      showToast(err instanceof Error ? err.message : "Failed to toggle traffic");
    }
  }, [isPaused, showToast]);

  const handleChangeStrategy = useCallback((strategyId: string) => {
    setRoutingStrategy(strategyId);
    if (isCloud) {
      setRoutingStrategyModule(strategyId);
      import("@tauri-apps/plugin-store").then(({ load }) =>
        load("settings.json").then(async (store) => {
          await store.set("cloudRoutingStrategy", strategyId);
          await store.save();
        })
      ).catch(() => {});
    } else {
      api.setRouting(strategyId).catch((err) => {
        showToast(err instanceof Error ? err.message : "Failed to change routing");
      });
    }
  }, [isCloud, showToast]);

  const handleAddPreference = useCallback(async () => {
    if (!selectedModel || !selectedProvider) return;
    setPrefSaving(true);
    try {
      const res = await api.addPreference(selectedModel, selectedProvider, prefAction);
      setPreferences((prev) => [...prev, {
        id: res.id,
        modelPattern: selectedModel,
        provider: selectedProvider,
        action: prefAction,
        priority: 0,
      }]);
      setSelectedModel("");
      setSelectedProvider("");
      setSearchQuery("");
      setShowAddPref(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to add preference");
    } finally {
      setPrefSaving(false);
    }
  }, [selectedModel, selectedProvider, prefAction, showToast]);

  const handleRemovePreference = useCallback(async (id: number) => {
    try {
      await api.removePreference(id);
      setPreferences((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to remove preference");
    }
  }, [showToast]);

  const ruleFilteredModels = useMemo(() => {
    const allModels = Array.from(modelIndex.keys()).sort();
    if (!ruleSearchQuery.trim()) return allModels;
    const q = ruleSearchQuery.toLowerCase();
    return allModels.filter((m) => stripRouterPrefix(m).toLowerCase().includes(q) || m.toLowerCase().includes(q));
  }, [modelIndex, ruleSearchQuery]);

  const MATCH_TYPE_META: Record<string, { label: string; color: string; icon: string }> = {
    model_alias: { label: "Alias", color: "#007AFF", icon: "\uD83C\uDFF7\uFE0F" },
    content_code: { label: "Code", color: "#5856D6", icon: "{ }" },
    content_long: { label: "Long", color: "#FF9500", icon: "\uD83D\uDCC4" },
    content_general: { label: "General", color: "#34C759", icon: "\uD83D\uDCAC" },
  };

  const saveCloudRules = useCallback((rules: RoutingRule[]) => {
    setRoutingRulesModule(rules.map(r => ({ matchType: r.matchType, matchValue: r.matchValue, targetModel: r.targetModel, enabled: r.enabled, priority: r.priority })));
    import("@tauri-apps/plugin-store").then(({ load }) =>
      load("settings.json").then(async (store) => {
        await store.set("cloudRoutingRules", rules);
        await store.save();
      })
    ).catch(() => {});
  }, []);

  const handleAddRule = useCallback(async () => {
    if (!ruleName || !ruleTargetModel) return;
    setRuleSaving(true);
    try {
      const matchValue = ruleMatchType === "model_alias"
        ? ruleMatchValue
        : ruleMatchType === "content_long"
          ? JSON.stringify({ min_chars: 8000 })
          : ruleMatchType === "content_code"
            ? JSON.stringify({ min_markers: 3 })
            : "{}";
      const newRule: RoutingRule = {
        id: isCloud ? Date.now() : 0,
        name: ruleName,
        matchType: ruleMatchType,
        matchValue,
        targetModel: ruleTargetModel,
        targetProvider: null,
        priority: 0,
        enabled: true,
      };
      if (isCloud) {
        const updated = [...routingRules, newRule];
        setRoutingRules(updated);
        saveCloudRules(updated);
      } else {
        const res = await api.addRoutingRule({
          name: ruleName,
          matchType: ruleMatchType,
          matchValue,
          targetModel: ruleTargetModel,
          targetProvider: null,
          priority: 0,
          enabled: true,
        });
        newRule.id = res.id;
        setRoutingRules((prev) => [...prev, newRule]);
      }
      setRuleName("");
      setRuleMatchValue("");
      setRuleTargetModel("");
      setRuleSearchQuery("");
      setShowAddRule(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to add rule");
    } finally {
      setRuleSaving(false);
    }
  }, [isCloud, ruleName, ruleMatchType, ruleMatchValue, ruleTargetModel, routingRules, saveCloudRules, showToast]);

  const handleToggleRule = useCallback(async (id: number, enabled: boolean) => {
    const rule = routingRules.find((r) => r.id === id);
    if (!rule) return;
    const updated = routingRules.map((r) => r.id === id ? { ...r, enabled } : r);
    setRoutingRules(updated);
    if (isCloud) {
      saveCloudRules(updated);
    } else {
      try {
        await api.updateRoutingRule(id, { ...rule, enabled });
      } catch {
        setRoutingRules((prev) => prev.map((r) => r.id === id ? { ...r, enabled: !enabled } : r));
      }
    }
  }, [isCloud, routingRules, saveCloudRules]);

  const handleRemoveRule = useCallback(async (id: number) => {
    if (isCloud) {
      const updated = routingRules.filter((r) => r.id !== id);
      setRoutingRules(updated);
      saveCloudRules(updated);
    } else {
      try {
        await api.removeRoutingRule(id);
        setRoutingRules((prev) => prev.filter((r) => r.id !== id));
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Failed to remove rule");
      }
    }
  }, [isCloud, routingRules, saveCloudRules, showToast]);

  const clearRuleForm = useCallback(() => {
    setRuleName("");
    setRuleMatchType("content_code");
    setRuleMatchValue("");
    setRuleTargetModel("");
    setRuleSearchQuery("");
    setEditingRuleId(null);
    setShowAddRule(false);
  }, []);

  const handleEditRule = useCallback((rule: RoutingRule) => {
    setShowAddRule(false);
    setEditingRuleId(rule.id);
    setRuleName(rule.name);
    setRuleMatchType(rule.matchType);
    setRuleMatchValue(rule.matchType === "model_alias" ? rule.matchValue : "");
    setRuleTargetModel(rule.targetModel);
    setRuleSearchQuery(stripRouterPrefix(rule.targetModel));
  }, []);

  const handleSaveEditRule = useCallback(async () => {
    if (editingRuleId === null || !ruleName || !ruleTargetModel) return;
    setRuleSaving(true);
    try {
      const matchValue = ruleMatchType === "model_alias"
        ? ruleMatchValue
        : ruleMatchType === "content_long"
          ? JSON.stringify({ min_chars: 8000 })
          : ruleMatchType === "content_code"
            ? JSON.stringify({ min_markers: 3 })
            : "{}";
      const updatedRule: Partial<RoutingRule> = {
        name: ruleName,
        matchType: ruleMatchType,
        matchValue,
        targetModel: ruleTargetModel,
      };
      if (isCloud) {
        const updated = routingRules.map((r) =>
          r.id === editingRuleId ? { ...r, ...updatedRule } : r
        );
        setRoutingRules(updated);
        saveCloudRules(updated);
      } else {
        const existing = routingRules.find((r) => r.id === editingRuleId);
        if (existing) {
          await api.updateRoutingRule(editingRuleId, { ...existing, ...updatedRule });
          setRoutingRules((prev) =>
            prev.map((r) => r.id === editingRuleId ? { ...r, ...updatedRule } : r)
          );
        }
      }
      clearRuleForm();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update rule");
    } finally {
      setRuleSaving(false);
    }
  }, [editingRuleId, isCloud, ruleName, ruleMatchType, ruleMatchValue, ruleTargetModel, routingRules, saveCloudRules, clearRuleForm, showToast]);

  const fmtPrice = (n: number) => n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(1)}`;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-4 pt-2 gap-3">
      {/* Cloud mode info card */}
      {isCloud && (
        <div className="m-1 p-4 rounded-xl bg-[#007AFF]/6 border border-[#007AFF]/15">
          <p className="text-[13px] font-semibold text-[#007AFF] mb-1">Cloud Routing</p>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            RouteBox Cloud automatically selects the best model for each request.
            You can customize the routing strategy and add rules below.
          </p>
        </div>
      )}

      {/* Available Models — cloud mode, grouped by provider */}
      {isCloud && modelsLoaded && cloudModels.length > 0 && (
        <CloudModelList
          models={cloudModels}
          isAdmin={isAdmin}
          registryModels={registryModels}
          registryLoading={registryLoading}
          onToggleStatus={async (model) => {
            const newStatus = model.status === "disabled" ? "active" : "disabled";
            try {
              await api.cloudAdminSetModelStatus(model.id, newStatus);
              setRegistryModels((prev) =>
                prev.map((m) => m.id === model.id ? { ...m, status: newStatus as CloudRegistryModel["status"] } : m)
              );
              // Refresh cloud models list
              await api.cloudGetModels()
                .then((res) => {
                  const sorted = [...res.data].sort((a, b) => a.id.localeCompare(b.id));
                  setCloudModels(sorted);
                  // Update modelIndex for routing rules
                  const idx = new Map<string, ModelProviderEntry[]>();
                  for (const m of res.data) {
                    idx.set(m.id, [{ provider: m.owned_by || "unknown", pricing: { input: 0, output: 0 } }]);
                  }
                  setModelIndex(idx);
                })
                .catch(() => {});
              showToast(`${model.modelId} ${newStatus === "disabled" ? "disabled" : "enabled"}`);
            } catch (err) {
              showToast(err instanceof Error ? err.message : "Failed to update model status");
            }
          }}
        />
      )}

      {/* Routing Strategy */}
      <div>
        <h3 className="section-header">Routing Strategy</h3>
        <div className="glass-card-static p-2">
          <RoutingStrategy
            current={routingStrategy}
            onChange={handleChangeStrategy}
          />
        </div>
      </div>

      {/* Model Preferences — local mode only */}
      {!isCloud && <div>
        <h3 className="section-header">Model Preferences</h3>
        <div className="glass-card-static overflow-hidden">
          {preferences.length === 0 && !showAddPref ? (
            <div className="px-3 py-4 text-center">
              <p className="text-[11px] text-text-tertiary mb-2">
                Pin models to providers or exclude specific provider+model combinations
              </p>
            </div>
          ) : (
            preferences.map((pref, i) => (
              <div
                key={pref.id}
                className={clsx(
                  "flex items-center justify-between h-9 px-3",
                  i < preferences.length - 1 && "border-b border-border-light"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {pref.action === "pin" ? (
                    <Pin size={12} strokeWidth={1.75} className="text-[#007AFF] shrink-0" />
                  ) : (
                    <Ban size={12} strokeWidth={1.75} className="text-[#FF3B30] shrink-0" />
                  )}
                  <span className="text-[12px] font-mono text-text-primary truncate">{stripRouterPrefix(pref.modelPattern)}</span>
                  <span className="text-[10px] text-text-secondary">{"\u2192"}</span>
                  <span className="text-[12px] text-text-secondary truncate">{pref.provider}</span>
                </div>
                <button
                  onClick={() => handleRemovePreference(pref.id)}
                  className="shrink-0 p-1 rounded hover:bg-hover-overlay transition-colors"
                >
                  <X size={12} strokeWidth={1.75} className="text-text-tertiary" />
                </button>
              </div>
            ))
          )}

          {showAddPref ? (
            <div className="p-3 border-t border-border-light space-y-2">
              {/* Pin / Exclude toggle */}
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-elevated">
                <button
                  onClick={() => setPrefAction("pin")}
                  className={clsx(
                    "flex-1 flex items-center justify-center gap-1 text-[10px] font-medium py-1 rounded-md transition-all",
                    prefAction === "pin"
                      ? "bg-[#007AFF] text-white shadow-sm"
                      : "text-text-secondary"
                  )}
                >
                  <Pin size={10} strokeWidth={2} />
                  Pin
                </button>
                <button
                  onClick={() => setPrefAction("exclude")}
                  className={clsx(
                    "flex-1 flex items-center justify-center gap-1 text-[10px] font-medium py-1 rounded-md transition-all",
                    prefAction === "exclude"
                      ? "bg-[#FF3B30] text-white shadow-sm"
                      : "text-text-secondary"
                  )}
                >
                  <Ban size={10} strokeWidth={2} />
                  Exclude
                </button>
              </div>

              {/* Model search */}
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedModel("");
                    setSelectedProvider("");
                  }}
                  placeholder="Search models..."
                  className="input text-[12px]"
                  style={{ paddingLeft: '32px' }}
                />
              </div>

              {/* Model list (scrollable) */}
              {!selectedModel && (
                <div className="max-h-[180px] overflow-y-auto rounded-lg border border-border-light">
                  {filteredModels.length === 0 ? (
                    <div className="px-3 py-3 text-[11px] text-text-tertiary text-center">
                      {!modelsLoaded ? "Loading models..." : modelIndex.size === 0 ? "No models — add a provider key first" : "No models match"}
                    </div>
                  ) : (
                    filteredModels.map((modelId) => {
                      const entries = modelIndex.get(modelId) || [];
                      return (
                        <button
                          key={modelId}
                          onClick={() => {
                            setSelectedModel(modelId);
                            setSearchQuery(stripRouterPrefix(modelId));
                          }}
                          className="flex items-center justify-between w-full px-3 py-1.5 text-left hover:bg-hover-overlay transition-colors border-b border-border-light last:border-b-0"
                        >
                          <span className="text-[12px] font-mono text-text-primary truncate">{stripRouterPrefix(modelId)}</span>
                          <span className="text-[10px] text-text-secondary shrink-0 ml-2">
                            {entries.length === 1
                              ? entries[0].provider
                              : `${entries.length} providers`}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}

              {/* Selected model → provider selector */}
              {selectedModel && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 px-1">
                    <span className="text-[11px] font-medium text-text-primary">
                      {stripRouterPrefix(selectedModel)}
                    </span>
                    <button
                      onClick={() => {
                        setSelectedModel("");
                        setSelectedProvider("");
                        setSearchQuery("");
                      }}
                      className="p-0.5 rounded hover:bg-hover-overlay transition-colors"
                    >
                      <X size={10} strokeWidth={2} className="text-text-secondary" />
                    </button>
                  </div>

                  {availableProviders.length <= 1 ? (
                    availableProviders.length === 1 && (
                      <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-bg-elevated">
                        <span className="text-[12px] text-text-primary">{availableProviders[0].provider}</span>
                        <span className="text-[10px] text-text-secondary">
                          {fmtPrice(availableProviders[0].pricing.input)}/{fmtPrice(availableProviders[0].pricing.output)} per 1M
                        </span>
                      </div>
                    )
                  ) : (
                    <div className="rounded-lg border border-border-light overflow-hidden">
                      {availableProviders.map((entry, i) => (
                        <button
                          key={entry.provider}
                          onClick={() => setSelectedProvider(entry.provider)}
                          className={clsx(
                            "flex items-center justify-between w-full px-2.5 py-1.5 text-left transition-colors",
                            selectedProvider === entry.provider
                              ? "bg-[#007AFF]/12"
                              : "hover:bg-hover-overlay",
                            i < availableProviders.length - 1 && "border-b border-border-light"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <div className={clsx(
                              "w-3 h-3 rounded-full border-2 flex items-center justify-center",
                              selectedProvider === entry.provider
                                ? "border-[#007AFF]"
                                : "border-text-tertiary"
                            )}>
                              {selectedProvider === entry.provider && (
                                <div className="w-1.5 h-1.5 rounded-full bg-[#007AFF]" />
                              )}
                            </div>
                            <span className="text-[12px] text-text-primary">{entry.provider}</span>
                          </div>
                          <span className="text-[10px] text-text-secondary">
                            {fmtPrice(entry.pricing.input)}/{fmtPrice(entry.pricing.output)} per 1M
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Save / Cancel */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAddPreference}
                  disabled={prefSaving || !selectedModel || !selectedProvider}
                  className={clsx(
                    "flex items-center gap-1 text-[11px] font-medium h-7 px-2.5 rounded-lg transition-colors",
                    prefSaving || !selectedModel || !selectedProvider
                      ? "text-text-tertiary cursor-not-allowed"
                      : "text-accent-cyan hover:bg-accent-cyan/10"
                  )}
                >
                  {prefSaving && <Loader2 size={11} strokeWidth={1.75} className="animate-spin" />}
                  Save
                </button>
                <button
                  onClick={() => {
                    setShowAddPref(false);
                    setSelectedModel("");
                    setSelectedProvider("");
                    setSearchQuery("");
                  }}
                  className="text-[11px] text-text-tertiary h-7 px-2 rounded-lg hover:bg-hover-overlay transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddPref(true)}
              className="flex items-center gap-1.5 w-full h-9 px-3 text-[12px] text-[#007AFF] hover:bg-hover-overlay transition-colors border-t border-border-light"
            >
              <Plus size={13} strokeWidth={2} />
              Add Preference
            </button>
          )}
        </div>
      </div>}

      {/* Routing Rules */}
      <div>
        <h3 className="section-header">Routing Rules</h3>
        <div className="glass-card-static overflow-hidden">
          {routingRules.length === 0 && !showAddRule ? (
            <div className="px-3 py-4 text-center">
              <p className="text-[11px] text-text-tertiary mb-2">
                Route requests based on content type or virtual model names
              </p>
            </div>
          ) : (
            routingRules.map((rule, i) => {
              const meta = MATCH_TYPE_META[rule.matchType] || MATCH_TYPE_META.content_general;
              return (
                <div
                  key={rule.id}
                  className={clsx(
                    "flex items-center justify-between h-10 px-3",
                    i < routingRules.length - 1 && "border-b border-border-light",
                    !rule.enabled && "opacity-50"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] shrink-0">{meta.icon}</span>
                    <span className="text-[12px] font-medium text-text-primary truncate">{rule.name}</span>
                    <span className="text-[10px] text-text-secondary">{"\u2192"}</span>
                    <span className="text-[11px] font-mono text-text-secondary truncate">{stripRouterPrefix(rule.targetModel)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className="text-[9px] font-medium px-1.5 py-0.5 rounded-md"
                      style={{ backgroundColor: meta.color + "20", color: meta.color }}
                    >
                      {meta.label}
                    </span>
                    <button
                      onClick={() => handleToggleRule(rule.id, !rule.enabled)}
                      className={clsx(
                        "relative w-7 h-4 rounded-full transition-colors duration-200",
                        rule.enabled ? "bg-[#34C759]" : "bg-toggle-off"
                      )}
                    >
                      <div className={clsx(
                        "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200",
                        rule.enabled ? "translate-x-3.5" : "translate-x-0.5"
                      )} />
                    </button>
                    <button
                      onClick={() => handleEditRule(rule)}
                      className="p-1 rounded hover:bg-hover-overlay transition-colors"
                      title="Edit rule"
                    >
                      <Pencil size={11} strokeWidth={1.75} className="text-text-tertiary" />
                    </button>
                    <button
                      onClick={() => handleRemoveRule(rule.id)}
                      className="p-1 rounded hover:bg-hover-overlay transition-colors"
                    >
                      <X size={12} strokeWidth={1.75} className="text-text-tertiary" />
                    </button>
                  </div>
                </div>
              );
            })
          )}

          {(showAddRule || editingRuleId !== null) ? (
            <div className="p-3 border-t border-border-light space-y-2.5">
              <span className="text-[11px] font-medium text-text-secondary">
                {editingRuleId !== null ? "Edit Rule" : "Add Rule"}
              </span>
              {/* Rule Name */}
              <input
                type="text"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="Rule name (e.g. Code tasks)"
                className="input text-[12px]"
              />

              {/* Match Type selector */}
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-elevated">
                {(["model_alias", "content_code", "content_long", "content_general"] as const).map((mt) => {
                  const meta = MATCH_TYPE_META[mt];
                  return (
                    <button
                      key={mt}
                      onClick={() => setRuleMatchType(mt)}
                      className={clsx(
                        "flex-1 text-[9px] font-medium py-1 rounded-md transition-all text-center",
                        ruleMatchType === mt
                          ? "text-white shadow-sm"
                          : "text-text-secondary"
                      )}
                      style={ruleMatchType === mt ? { backgroundColor: meta.color } : undefined}
                    >
                      {meta.label}
                    </button>
                  );
                })}
              </div>

              {ruleMatchType === "model_alias" && (
                <input
                  type="text"
                  value={ruleMatchValue}
                  onChange={(e) => setRuleMatchValue(e.target.value)}
                  placeholder="Virtual model name (e.g. route-code)"
                  className="input text-[12px]"
                />
              )}

              {ruleMatchType === "content_long" && (
                <p className="text-[10px] text-text-tertiary px-0.5">Auto-detect: messages ≥ 8,000 chars</p>
              )}
              {ruleMatchType === "content_code" && (
                <p className="text-[10px] text-text-tertiary px-0.5">Auto-detect: ≥ 3 code markers (```, imports, etc.)</p>
              )}
              {ruleMatchType === "content_general" && (
                <p className="text-[10px] text-text-tertiary px-0.5">Matches all other requests as fallback</p>
              )}

              <span className="text-[10px] font-medium text-text-tertiary px-0.5">Target Model</span>
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                <input
                  type="text"
                  value={ruleSearchQuery}
                  onChange={(e) => {
                    setRuleSearchQuery(e.target.value);
                    setRuleTargetModel("");
                  }}
                  placeholder="Target model..."
                  className="input text-[12px]"
                  style={{ paddingLeft: '32px' }}
                />
              </div>

              {!ruleTargetModel && (
                <div className="max-h-[140px] overflow-y-auto rounded-lg border border-border-light">
                  {ruleFilteredModels.length === 0 ? (
                    <div className="px-3 py-3 text-[11px] text-text-tertiary text-center">
                      {!modelsLoaded ? "Loading models..." : modelIndex.size === 0 ? "No models — add a provider key first" : "No models match"}
                    </div>
                  ) : (
                    ruleFilteredModels.slice(0, 30).map((modelId) => (
                      <button
                        key={modelId}
                        onClick={() => {
                          setRuleTargetModel(modelId);
                          setRuleSearchQuery(stripRouterPrefix(modelId));
                        }}
                        className="flex items-center w-full px-3 py-1.5 text-left hover:bg-hover-overlay transition-colors border-b border-border-light last:border-b-0"
                      >
                        <span className="text-[12px] font-mono text-text-primary truncate">{stripRouterPrefix(modelId)}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {ruleTargetModel && (
                <div className="flex items-center gap-1.5 px-1">
                  <span className="text-[11px] font-medium text-text-primary">{stripRouterPrefix(ruleTargetModel)}</span>
                  <button
                    onClick={() => { setRuleTargetModel(""); setRuleSearchQuery(""); }}
                    className="p-0.5 rounded hover:bg-hover-overlay transition-colors"
                  >
                    <X size={10} strokeWidth={2} className="text-text-secondary" />
                  </button>
                </div>
              )}

              {/* Save / Cancel */}
              <div className="flex items-center gap-2">
                <button
                  onClick={editingRuleId !== null ? handleSaveEditRule : handleAddRule}
                  disabled={ruleSaving || !ruleName || !ruleTargetModel}
                  className={clsx(
                    "flex items-center gap-1 text-[11px] font-medium h-7 px-2.5 rounded-lg transition-colors",
                    ruleSaving || !ruleName || !ruleTargetModel
                      ? "text-text-tertiary cursor-not-allowed"
                      : "text-accent-cyan hover:bg-accent-cyan/10"
                  )}
                >
                  {ruleSaving && <Loader2 size={11} strokeWidth={1.75} className="animate-spin" />}
                  {editingRuleId !== null ? "Save" : "Save Rule"}
                </button>
                {!ruleSaving && (!ruleName || !ruleTargetModel) && (
                  <span className="text-[9px] text-text-tertiary">
                    {!ruleName ? "Enter a rule name" : "Select a target model"}
                  </span>
                )}
                <button
                  onClick={clearRuleForm}
                  className="text-[11px] text-text-tertiary h-7 px-2 rounded-lg hover:bg-hover-overlay transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : editingRuleId === null ? (
            <button
              onClick={() => setShowAddRule(true)}
              className="flex items-center gap-1.5 w-full h-9 px-3 text-[12px] text-[#007AFF] hover:bg-hover-overlay transition-colors border-t border-border-light"
            >
              <Plus size={13} strokeWidth={2} />
              Add Rule
            </button>
          ) : null}
        </div>
      </div>

      {/* Provider Status */}
      {!isCloud && <ProviderStatus providers={stats.providers} />}

      {/* Models error message */}
      {modelsError && (
        <p className="text-[11px] text-text-secondary text-center py-2">
          {isCloud
            ? "Failed to load models. Check your internet connection."
            : "Failed to load models. Check your connection and gateway status."}
        </p>
      )}

      {/* Controls — local mode only */}
      {!isCloud && <div>
        <h3 className="section-header">Controls</h3>
        <div className="grid grid-cols-2 gap-2">
          <button className="glass-card p-3 flex items-center gap-2.5" onClick={handleCopyKey}>
            {copied ? (
              <Check size={16} strokeWidth={1.75} className="text-[#34C759]" />
            ) : (
              <Copy size={16} strokeWidth={1.75} className="text-text-primary" />
            )}
            <div className="flex flex-col items-start">
              <span className="text-[12px] font-medium text-text-primary">
                {copied ? "Copied!" : "Copy Key"}
              </span>
              <span className="text-[9px] text-text-tertiary">{"\u2318"}C</span>
            </div>
          </button>

          <button className="glass-card p-3 flex items-center gap-2.5" onClick={handleTogglePause}>
            {isPaused ? (
              <Play size={16} strokeWidth={1.75} className="text-text-primary" />
            ) : (
              <Pause size={16} strokeWidth={1.75} className="text-text-primary" />
            )}
            <div className="flex flex-col items-start">
              <span className="text-[12px] font-medium text-text-primary">
                {isPaused ? "Resume" : "Pause"}
              </span>
              <span className="text-[9px] text-text-tertiary">{"\u2318"}P</span>
            </div>
          </button>
        </div>
      </div>}
    </div>
  );
}

/** Strip provider routing prefix (e.g. "openrouter/") for cleaner display */
function stripRouterPrefix(id: string): string {
  return id.replace(/^openrouter\//, "");
}

interface CloudModelListProps {
  models: CloudModelEntry[];
  isAdmin?: boolean;
  registryModels?: CloudRegistryModel[];
  registryLoading?: boolean;
  onToggleStatus?: (model: CloudRegistryModel) => void;
}

function CloudModelList({ models, isAdmin, registryModels, registryLoading, onToggleStatus }: CloudModelListProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleCopyModel = useCallback(async (modelId: string) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("copy_to_clipboard", { text: modelId });
      } catch {
        await navigator.clipboard.writeText(modelId);
      }
    } catch {
      await navigator.clipboard.writeText(modelId);
    }
    setCopiedId(modelId);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedId(null), 1500);
  }, []);

  // In admin mode, show all registry models; otherwise show available models
  const displayModels = isAdmin && registryModels && registryModels.length > 0
    ? registryModels
    : null;

  const statusBadge = (status: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      active: { bg: "rgba(52,199,89,0.15)", text: "#34C759" },
      beta: { bg: "rgba(0,122,255,0.15)", text: "#007AFF" },
      deprecated: { bg: "rgba(142,142,147,0.15)", text: "#8E8E93" },
      disabled: { bg: "rgba(255,59,48,0.15)", text: "#FF3B30" },
    };
    const c = colors[status] ?? colors.active;
    return (
      <span
        className="text-[9px] font-medium px-1.5 py-0.5 rounded-md shrink-0"
        style={{ backgroundColor: c.bg, color: c.text }}
      >
        {status}
      </span>
    );
  };

  const activeCount = displayModels ? displayModels.filter((m) => m.status !== "disabled").length : 0;
  const disabledCount = displayModels ? displayModels.length - activeCount : 0;
  const totalCount = displayModels ? displayModels.length : models.length;

  const headerLabel = isAdmin && displayModels
    ? disabledCount > 0
      ? `Model Registry (${activeCount} active, ${disabledCount} disabled)`
      : `Model Registry (${totalCount})`
    : `Available Models (${totalCount})`;

  return (
    <div>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="section-header flex items-center gap-1.5 w-full text-left cursor-pointer hover:text-text-primary transition-colors"
      >
        <ChevronDown
          size={13}
          strokeWidth={2}
          className={clsx(
            "transition-transform duration-200 shrink-0",
            collapsed && "-rotate-90"
          )}
        />
        {registryLoading ? (
          <span className="flex items-center gap-1.5">
            Model Registry <Loader2 size={11} className="animate-spin" />
          </span>
        ) : headerLabel}
      </button>
      {!collapsed && (
        <div className="glass-card-static overflow-hidden">
          {registryLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={16} className="animate-spin text-text-tertiary" />
            </div>
          ) : displayModels ? (
            // Admin view: full registry with toggles
            displayModels.map((model, i) => {
              const isDisabled = model.status === "disabled";
              const isDeprecated = model.status === "deprecated";
              return (
                <div
                  key={model.id}
                  className={clsx(
                    "group flex items-center justify-between py-2 px-4",
                    i < displayModels.length - 1 && "border-b border-border-light",
                    isDisabled && "opacity-50"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={clsx(
                      "text-[11px] font-mono truncate",
                      isDisabled ? "text-text-tertiary" : "text-text-secondary"
                    )}>
                      {stripRouterPrefix(model.modelId)}
                    </span>
                    {statusBadge(model.status)}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] text-text-tertiary">{model.provider}</span>
                    {isDeprecated && (
                      <span className="text-[9px] text-text-tertiary italic" title="Permanently deprecated — cannot be toggled">
                        deprecated
                      </span>
                    )}
                    {!isDeprecated && onToggleStatus && (
                      <button
                        onClick={async () => {
                          setTogglingId(model.id);
                          try {
                            await onToggleStatus(model);
                          } finally {
                            setTogglingId(null);
                          }
                        }}
                        disabled={togglingId === model.id}
                        className={clsx(
                          "relative w-7 h-4 rounded-full transition-colors duration-200",
                          togglingId === model.id && "opacity-50",
                          !isDisabled ? "bg-[#34C759]" : "bg-toggle-off"
                        )}
                      >
                        <div className={clsx(
                          "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-200",
                          !isDisabled ? "translate-x-3.5" : "translate-x-0.5"
                        )} />
                      </button>
                    )}
                    <button
                      onClick={() => handleCopyModel(model.modelId)}
                      className="shrink-0 p-1 rounded hover:bg-hover-overlay transition-colors opacity-0 group-hover:opacity-100"
                      title="Copy model ID"
                    >
                      {copiedId === model.modelId ? (
                        <Check size={11} strokeWidth={2} className="text-[#34C759]" />
                      ) : (
                        <Copy size={11} strokeWidth={1.75} className="text-text-tertiary" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            // Normal user view — enhanced with metadata
            models.map((model, i) => (
              <div
                key={model.id}
                className={clsx(
                  "group flex items-center justify-between py-2 px-4",
                  i < models.length - 1 && "border-b border-border-light"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-mono text-text-secondary truncate">
                    {model.display_name && model.display_name !== model.id
                      ? model.display_name
                      : stripRouterPrefix(model.id)}
                  </span>
                  {model.display_name && model.display_name !== model.id && model.id !== "auto" && (
                    <span className="text-[9px] font-mono text-text-tertiary truncate">
                      {stripRouterPrefix(model.id)}
                    </span>
                  )}
                  {model.id === "auto" && (
                    <span
                      className="text-[9px] font-medium px-1.5 py-0.5 rounded-md shrink-0"
                      style={{ backgroundColor: "rgba(94,92,230,0.15)", color: "#5E5CE6" }}
                    >
                      Smart Routing
                    </span>
                  )}
                  {model.tier === "flagship" && (
                    <span
                      className="text-[9px] font-medium px-1.5 py-0.5 rounded-md shrink-0"
                      style={{ backgroundColor: "rgba(255,149,0,0.15)", color: "#FF9500" }}
                    >
                      flagship
                    </span>
                  )}
                  {model.status === "beta" && statusBadge("beta")}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[9px] text-text-tertiary">{model.owned_by}</span>
                  <button
                    onClick={() => handleCopyModel(model.id)}
                    className="shrink-0 p-1 rounded hover:bg-hover-overlay transition-colors opacity-0 group-hover:opacity-100"
                    title="Copy model ID"
                  >
                    {copiedId === model.id ? (
                      <Check size={11} strokeWidth={2} className="text-[#34C759]" />
                    ) : (
                      <Copy size={11} strokeWidth={1.75} className="text-text-tertiary" />
                    )}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
