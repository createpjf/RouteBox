import { useState, useEffect, useCallback } from "react";
import { Key, Trash2, Check, Loader2, AlertCircle, Shield } from "lucide-react";
import clsx from "clsx";
import { api, type ProviderRegistryEntry } from "@/lib/api";

interface ProviderKeyManagerProps {
  /** Called when a key is saved/deleted so parent can react */
  onProvidersChanged?: () => void;
}

export function ProviderKeyManager({ onProvidersChanged }: ProviderKeyManagerProps) {
  const [providers, setProviders] = useState<ProviderRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successProvider, setSuccessProvider] = useState<string | null>(null);

  const fetchRegistry = useCallback(async () => {
    try {
      const res = await api.getProviderRegistry();
      setProviders(res.providers);
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
  );
}
