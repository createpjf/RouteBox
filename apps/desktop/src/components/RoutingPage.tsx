import { useState, useCallback, useEffect } from "react";
import { Copy, Check, Pause, Play, Plus, X, Pin, Ban, Loader2 } from "lucide-react";
import clsx from "clsx";
import { ProviderStatus } from "@/components/ProviderStatus";
import { RoutingStrategy } from "@/components/RoutingStrategy";
import { api } from "@/lib/api";
import type { ModelPreference } from "@/lib/api";
import type { RealtimeStats } from "@/types/stats";

interface RoutingPageProps {
  stats: RealtimeStats;
  showToast: (msg: string) => void;
}

export function RoutingPage({ stats, showToast }: RoutingPageProps) {
  const [isPaused, setIsPaused] = useState(false);
  const [routingStrategy, setRoutingStrategy] = useState("smart_auto");
  const [copied, setCopied] = useState(false);

  // Model preferences
  const [preferences, setPreferences] = useState<ModelPreference[]>([]);
  const [showAddPref, setShowAddPref] = useState(false);
  const [prefPattern, setPrefPattern] = useState("");
  const [prefProvider, setPrefProvider] = useState("");
  const [prefAction, setPrefAction] = useState<"pin" | "exclude">("pin");
  const [prefSaving, setPrefSaving] = useState(false);

  useEffect(() => {
    api.getTrafficStatus()
      .then((res) => setIsPaused(res.paused))
      .catch(() => {});
    api.getRouting()
      .then((res) => setRoutingStrategy(res.current))
      .catch(() => {});
    api.getPreferences()
      .then((res) => setPreferences(res.preferences))
      .catch(() => {});
  }, []);

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
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to copy key");
    }
  }, [showToast]);

  const handleTogglePause = useCallback(async () => {
    try {
      if (isPaused) {
        await api.resumeTraffic();
      } else {
        await api.pauseTraffic();
      }
      setIsPaused(!isPaused);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to toggle traffic");
    }
  }, [isPaused, showToast]);

  const handleChangeStrategy = useCallback((strategyId: string) => {
    setRoutingStrategy(strategyId);
    api.setRouting(strategyId).catch((err) => {
      showToast(err instanceof Error ? err.message : "Failed to change routing");
    });
  }, [showToast]);

  const handleAddPreference = useCallback(async () => {
    if (!prefPattern.trim() || !prefProvider.trim()) return;
    setPrefSaving(true);
    try {
      const res = await api.addPreference(prefPattern.trim(), prefProvider.trim(), prefAction);
      setPreferences((prev) => [...prev, {
        id: res.id,
        modelPattern: prefPattern.trim(),
        provider: prefProvider.trim(),
        action: prefAction,
        priority: 0,
      }]);
      setPrefPattern("");
      setPrefProvider("");
      setShowAddPref(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to add preference");
    } finally {
      setPrefSaving(false);
    }
  }, [prefPattern, prefProvider, prefAction, showToast]);

  const handleRemovePreference = useCallback(async (id: number) => {
    try {
      await api.removePreference(id);
      setPreferences((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to remove preference");
    }
  }, [showToast]);

  const activeProviderNames = stats.providers.filter((p) => p.isUp).map((p) => p.name);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-5 pt-2 gap-5">
      {/* Routing Strategy */}
      <div>
        <h3 className="section-header">Routing Strategy</h3>
        <div className="glass-card-static p-1">
          <RoutingStrategy
            current={routingStrategy}
            onChange={handleChangeStrategy}
          />
        </div>
      </div>

      {/* Model Preferences */}
      <div>
        <h3 className="section-header">Model Preferences</h3>
        <div className="glass-card-static overflow-hidden">
          {preferences.length === 0 && !showAddPref ? (
            <div className="px-3 py-4 text-center">
              <p className="text-[11px] text-text-tertiary mb-2">
                Pin models to providers or exclude specific providers
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
                  <span className="text-[12px] font-mono text-[#1D1D1F] truncate">{pref.modelPattern}</span>
                  <span className="text-[10px] text-[#86868B]">→</span>
                  <span className="text-[12px] text-[#86868B] truncate">{pref.provider}</span>
                </div>
                <button
                  onClick={() => handleRemovePreference(pref.id)}
                  className="shrink-0 p-1 rounded hover:bg-[#F2F2F7] transition-colors"
                >
                  <X size={12} strokeWidth={1.75} className="text-[#C7C7CC]" />
                </button>
              </div>
            ))
          )}

          {showAddPref ? (
            <div className="p-3 border-t border-border-light space-y-2">
              <input
                type="text"
                value={prefPattern}
                onChange={(e) => setPrefPattern(e.target.value)}
                placeholder="Model pattern (e.g. gpt-*, claude-*)"
                className="input text-[12px]"
              />
              <select
                value={prefProvider}
                onChange={(e) => setPrefProvider(e.target.value)}
                className="input text-[12px]"
              >
                <option value="">Select provider...</option>
                {activeProviderNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#F2F2F7]">
                <button
                  onClick={() => setPrefAction("pin")}
                  className={clsx(
                    "flex-1 flex items-center justify-center gap-1 text-[10px] font-medium py-1 rounded-md transition-all",
                    prefAction === "pin"
                      ? "bg-[#007AFF] text-white shadow-sm"
                      : "text-[#86868B]"
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
                      : "text-[#86868B]"
                  )}
                >
                  <Ban size={10} strokeWidth={2} />
                  Exclude
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAddPreference}
                  disabled={prefSaving || !prefPattern.trim() || !prefProvider}
                  className={clsx(
                    "flex items-center gap-1 text-[11px] font-medium h-7 px-2.5 rounded-lg transition-colors",
                    prefSaving || !prefPattern.trim() || !prefProvider
                      ? "text-text-tertiary cursor-not-allowed"
                      : "text-accent-cyan hover:bg-accent-cyan/10"
                  )}
                >
                  {prefSaving && <Loader2 size={11} strokeWidth={1.75} className="animate-spin" />}
                  Save
                </button>
                <button
                  onClick={() => setShowAddPref(false)}
                  className="text-[11px] text-text-tertiary h-7 px-2 rounded-lg hover:bg-[#F2F2F7] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddPref(true)}
              className="flex items-center gap-1.5 w-full h-9 px-3 text-[12px] text-[#007AFF] hover:bg-[#F2F2F7] transition-colors border-t border-border-light"
            >
              <Plus size={13} strokeWidth={2} />
              Add Preference
            </button>
          )}
        </div>
      </div>

      {/* Provider Status */}
      <ProviderStatus providers={stats.providers} />

      {/* Controls — 2-column grid matching reference */}
      <div>
        <h3 className="section-header">Controls</h3>
        <div className="grid grid-cols-2 gap-2.5">
          <button className="glass-card p-4 flex flex-col items-center gap-2" onClick={handleCopyKey}>
            {copied ? (
              <Check size={20} strokeWidth={1.6} className="text-[#34C759]" />
            ) : (
              <Copy size={20} strokeWidth={1.6} className="text-[#1D1D1F]" />
            )}
            <span className="text-[13px] font-medium text-[#1D1D1F]">
              {copied ? "Copied!" : "Copy Key"}
            </span>
            <span className="text-[10px] font-medium text-[#C7C7CC] bg-[#F5F5F7] px-2 py-0.5 rounded-md">
              {"\u2318"}C
            </span>
          </button>

          <button className="glass-card p-4 flex flex-col items-center gap-2" onClick={handleTogglePause}>
            {isPaused ? (
              <Play size={20} strokeWidth={1.8} className="text-[#1D1D1F]" />
            ) : (
              <Pause size={20} strokeWidth={1.8} className="text-[#1D1D1F]" />
            )}
            <span className="text-[13px] font-medium text-[#1D1D1F]">
              {isPaused ? "Resume" : "Pause"}
            </span>
            <span className="text-[10px] font-medium text-[#C7C7CC] bg-[#F5F5F7] px-2 py-0.5 rounded-md">
              {"\u2318"}P
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
