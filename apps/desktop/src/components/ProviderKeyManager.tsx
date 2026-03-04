import { useState, useEffect, useCallback } from "react";
import { Key, Trash2, Check, Loader2, AlertCircle, Shield, RefreshCw, Monitor } from "lucide-react";
import clsx from "clsx";
import { api, type ProviderRegistryEntry, type LocalProviderInfo } from "@/lib/api";

interface ProviderKeyManagerProps {
  /** Called when a key is saved/deleted so parent can react */
  onProvidersChanged?: () => void;
}

export function ProviderKeyManager({ onProvidersChanged }: ProviderKeyManagerProps) {
  const [providers, setProviders] = useState<ProviderRegistryEntry[]>([]);
  const [localProviders, setLocalProviders] = useState<LocalProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successProvider, setSuccessProvider] = useState<string | null>(null);
  const [editingLocalUrl, setEditingLocalUrl] = useState<string | null>(null);
  const [localUrlInput, setLocalUrlInput] = useState("");
  const [localApiKeyInput, setLocalApiKeyInput] = useState("");
  const [refreshingLocal, setRefreshingLocal] = useState<string | null>(null);

  const fetchRegistry = useCallback(async () => {
    try {
      const [regRes, localRes] = await Promise.all([
        api.getProviderRegistry(),
        api.getLocalProviders().catch(() => ({ providers: [] })),
      ]);
      setProviders(regRes.providers);
      setLocalProviders(localRes.providers);
    } catch {
      // silent — may not be connected yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  const handleSaveKey = useCallback(async (name: string) => {
    if (!keyInput.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.setProviderKey(name, keyInput.trim());
      setEditingProvider(null);
      setKeyInput("");
      setSuccessProvider(name);
      setTimeout(() => setSuccessProvider(null), 2000);
      await fetchRegistry();
      onProvidersChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setSaving(false);
    }
  }, [keyInput, fetchRegistry, onProvidersChanged]);

  const handleDeleteKey = useCallback(async (name: string) => {
    try {
      await api.deleteProviderKey(name);
      await fetchRegistry();
      onProvidersChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }, [fetchRegistry, onProvidersChanged]);

  const handleRefreshLocal = useCallback(async (name: string) => {
    setRefreshingLocal(name);
    try {
      const updated = await api.refreshLocalProvider(name);
      setLocalProviders((prev) =>
        prev.map((lp) => lp.name === name ? { ...lp, ...updated } : lp)
      );
    } catch {}
    setRefreshingLocal(null);
  }, []);

  const handleSaveLocalUrl = useCallback(async (name: string) => {
    if (!localUrlInput.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const apiKeyArg = localApiKeyInput.trim() || undefined;
      const updated = await api.setLocalProviderUrl(name, localUrlInput.trim(), apiKeyArg);
      setLocalProviders((prev) =>
        prev.map((lp) => lp.name === name ? { ...lp, ...updated } : lp)
      );
      setEditingLocalUrl(null);
      setLocalUrlInput("");
      setLocalApiKeyInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update URL");
    } finally {
      setSaving(false);
    }
  }, [localUrlInput, localApiKeyInput]);

  if (loading) {
    return (
      <div className="glass-card-static p-3 flex items-center justify-center">
        <Loader2 size={14} strokeWidth={1.75} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <div className="glass-card-static p-3">
        <p className="text-[11px] text-text-tertiary text-center">
          Connect to gateway to manage providers
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
    {/* Local providers */}
    {localProviders.length > 0 && (
      <div className="glass-card-static overflow-hidden">
        <div className="flex items-center gap-1.5 px-3 h-8 border-b border-border-light">
          <Monitor size={12} strokeWidth={1.75} className="text-text-tertiary" />
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">Local</span>
        </div>
        {localProviders.map((lp, idx) => {
          const isEditingUrl = editingLocalUrl === lp.name;
          const isRefreshing = refreshingLocal === lp.name;
          const isLast = idx === localProviders.length - 1;

          return (
            <div key={lp.name}>
              <div
                className={clsx(
                  "flex items-center gap-2.5 h-10 px-3 transition-colors",
                  !isEditingUrl && "cursor-pointer hover:bg-bg-row-hover",
                  !isLast && !isEditingUrl && "border-b border-border-light"
                )}
                onClick={() => {
                  if (!isEditingUrl) {
                    setEditingLocalUrl(lp.name);
                    setLocalUrlInput(lp.baseUrl);
                    setLocalApiKeyInput("");
                    setError(null);
                  }
                }}
              >
                <div
                  className={clsx(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    lp.isOnline ? "bg-accent-green" : "bg-text-tertiary/40"
                  )}
                />
                <span className="text-[13px] text-text-primary flex-1">{lp.name}</span>
                <div className="flex items-center gap-1.5">
                  {lp.hasApiKey && (
                    <span title="API key configured">
                      <Key size={10} strokeWidth={1.75} className="text-text-tertiary/60" />
                    </span>
                  )}
                  {lp.isOnline ? (
                    <span className="text-[11px] text-text-tertiary">
                      {lp.modelCount} model{lp.modelCount !== 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span className="text-[11px] text-text-tertiary">Offline</span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRefreshLocal(lp.name);
                    }}
                    className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-bg-input transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw
                      size={12}
                      strokeWidth={1.75}
                      className={clsx("text-text-tertiary", isRefreshing && "animate-spin")}
                    />
                  </button>
                </div>
              </div>

              {isEditingUrl && (
                <div className={clsx("px-3 pb-2.5 pt-1", !isLast && "border-b border-border-light")}>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={localUrlInput}
                      onChange={(e) => {
                        setLocalUrlInput(e.target.value);
                        setError(null);
                      }}
                      placeholder={`Base URL (e.g. http://192.168.1.100:1234/v1)`}
                      className="input input-mono flex-1 !h-8 !text-[11px]"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveLocalUrl(lp.name);
                        if (e.key === "Escape") {
                          setEditingLocalUrl(null);
                          setLocalApiKeyInput("");
                          setError(null);
                        }
                      }}
                    />
                    <button
                      onClick={() => handleSaveLocalUrl(lp.name)}
                      disabled={saving || !localUrlInput.trim()}
                      className={clsx(
                        "btn-primary !h-8 !text-[11px] !px-3 shrink-0",
                        (saving || !localUrlInput.trim()) && "opacity-40 cursor-not-allowed"
                      )}
                    >
                      {saving ? (
                        <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                      ) : (
                        "Save"
                      )}
                    </button>
                  </div>
                  <input
                    type="password"
                    value={localApiKeyInput}
                    onChange={(e) => setLocalApiKeyInput(e.target.value)}
                    placeholder={lp.hasApiKey ? "API Key (configured — leave blank to keep)" : "API Key (optional)"}
                    className="input input-mono w-full !h-8 !text-[11px] mt-1.5"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveLocalUrl(lp.name);
                      if (e.key === "Escape") {
                        setEditingLocalUrl(null);
                        setLocalApiKeyInput("");
                        setError(null);
                      }
                    }}
                  />
                  {error && editingLocalUrl === lp.name && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <AlertCircle size={12} strokeWidth={1.75} className="text-accent-red shrink-0" />
                      <span className="text-[11px] text-accent-red">{error}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    )}

    {/* Cloud providers */}
    <div className="glass-card-static overflow-hidden">
      {providers.map((p, idx) => {
        const isEditing = editingProvider === p.name;
        const justSaved = successProvider === p.name;
        const isLast = idx === providers.length - 1;

        return (
          <div key={p.name}>
            <div
              className={clsx(
                "flex items-center gap-2.5 h-10 px-3 transition-colors",
                !isEditing && !p.hasKey && "cursor-pointer hover:bg-bg-row-hover",
                !isLast && !isEditing && "border-b border-border-light"
              )}
              onClick={() => {
                if (!isEditing && !p.hasKey) {
                  setEditingProvider(p.name);
                  setKeyInput("");
                  setError(null);
                }
              }}
            >
              {/* Status dot */}
              <div
                className={clsx(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  p.isActive ? "bg-accent-green" : "bg-text-tertiary/40"
                )}
              />

              {/* Name */}
              <span className="text-[13px] text-text-primary flex-1">{p.name}</span>

              {/* Status */}
              {justSaved ? (
                <span className="flex items-center gap-1 text-[11px] text-accent-green font-medium">
                  <Check size={12} strokeWidth={2} />
                  Saved
                </span>
              ) : p.hasKey ? (
                <div className="flex items-center gap-1.5">
                  {p.keySource === "env" ? (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-text-tertiary bg-bg-input px-1.5 py-0.5 rounded-md">
                      <Shield size={10} strokeWidth={1.75} />
                      ENV
                    </span>
                  ) : (
                    <>
                      <span className="text-[11px] font-mono text-text-tertiary">
                        {p.maskedKey}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteKey(p.name);
                        }}
                        className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-accent-red/10 transition-colors"
                      >
                        <Trash2 size={12} strokeWidth={1.75} className="text-text-tertiary hover:text-accent-red" />
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
                  <Key size={12} strokeWidth={1.75} />
                  Add key
                </span>
              )}
            </div>

            {/* Inline key editor */}
            {isEditing && (
              <div className={clsx("px-3 pb-2.5 pt-1", !isLast && "border-b border-border-light")}>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => {
                      setKeyInput(e.target.value);
                      setError(null);
                    }}
                    placeholder={`Enter ${p.name} API key`}
                    className="input input-mono flex-1 !h-8 !text-[11px]"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveKey(p.name);
                      if (e.key === "Escape") {
                        setEditingProvider(null);
                        setError(null);
                      }
                    }}
                  />
                  <button
                    onClick={() => handleSaveKey(p.name)}
                    disabled={saving || !keyInput.trim()}
                    className={clsx(
                      "btn-primary !h-8 !text-[11px] !px-3 shrink-0",
                      (saving || !keyInput.trim()) && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    {saving ? (
                      <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                    ) : (
                      "Validate & Save"
                    )}
                  </button>
                </div>
                {error && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <AlertCircle size={12} strokeWidth={1.75} className="text-accent-red shrink-0" />
                    <span className="text-[11px] text-accent-red">{error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}
