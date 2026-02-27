import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Globe, Key, Keyboard, Info, Check, Loader2, Trash2 } from "lucide-react";
import clsx from "clsx";
import { getGatewayUrl, setGatewayUrl as setGatewayUrlGlobal, setAuthToken } from "@/lib/constants";

interface SettingsProps {
  onBack: () => void;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function loadStore() {
  const { load } = await import("@tauri-apps/plugin-store");
  return load("settings.json", { defaults: {}, autoSave: true });
}

export function Settings({ onBack }: SettingsProps) {
  const [gatewayUrl, setGatewayUrl] = useState(getGatewayUrl);
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    tauriInvoke<string>("get_token")
      .then((t) => {
        if (t) {
          setToken(t);
          setHasToken(true);
        }
      })
      .catch(() => {});

    loadStore()
      .then(async (store) => {
        const url = await store.get<string>("gatewayUrl");
        if (url) {
          setGatewayUrl(url);
          setGatewayUrlGlobal(url);
        }
      })
      .catch(() => {});
  }, []);

  const handleSaveToken = useCallback(async () => {
    if (!token.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await tauriInvoke("store_token", { token: token.trim() });
      setAuthToken(token.trim());
      setHasToken(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [token]);

  const handleDeleteToken = useCallback(async () => {
    try {
      await tauriInvoke("delete_token");
      setAuthToken("");
      setToken("");
      setHasToken(false);
    } catch {}
  }, []);

  const handleQuit = useCallback(async () => {
    try {
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    } catch {
      window.close();
    }
  }, []);

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-2 h-11 px-4 border-b border-border shrink-0">
        <button
          onClick={onBack}
          className="flex items-center justify-center h-7 w-7 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-white/[0.05] transition-colors"
        >
          <ArrowLeft size={14} strokeWidth={1.75} />
        </button>
        <span className="text-[13px] font-semibold text-text-primary tracking-[-0.01em]">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2">
        {/* Connection */}
        <div className="glass-card-static rounded-xl p-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-white/[0.05]">
              <Globe size={14} strokeWidth={1.75} className="text-text-secondary" />
            </div>
            <span className="text-[13px] font-semibold text-text-secondary">Connection</span>
          </div>
          <label className="block text-[11px] text-text-tertiary font-medium mb-1.5">Gateway URL</label>
          <input
            type="text"
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
            onBlur={() => {
              const raw = gatewayUrl.trim().replace(/\/+$/, "") || "http://localhost:3001";
              try {
                const parsed = new URL(raw);
                if (!["http:", "https:"].includes(parsed.protocol)) {
                  setUrlError("URL must start with http:// or https://");
                  return;
                }
                setUrlError(null);
                setGatewayUrl(raw);
                setGatewayUrlGlobal(raw);
                loadStore()
                  .then((store) => store.set("gatewayUrl", raw))
                  .catch(() => {});
              } catch {
                setUrlError("Invalid URL format");
              }
            }}
            className={`glass-input glass-input-mono ${urlError ? "!border-accent-red/50" : ""}`}
          />
          {urlError && (
            <p className="mt-1 text-[11px] text-accent-red">{urlError}</p>
          )}
        </div>

        {/* Authentication */}
        <div className="glass-card-static rounded-xl p-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-white/[0.05]">
              <Key size={14} strokeWidth={1.75} className="text-text-secondary" />
            </div>
            <span className="text-[13px] font-semibold text-text-secondary">Authentication</span>
          </div>
          <label className="block text-[11px] text-text-tertiary font-medium mb-1.5">API Token</label>
          <input
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setSaved(false);
            }}
            placeholder="Enter your RouteBox token"
            className="glass-input"
          />
          {error && (
            <p className="mt-1.5 text-[11px] text-accent-red">{error}</p>
          )}
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={handleSaveToken}
              disabled={saving || !token.trim()}
              className={clsx(
                "flex items-center gap-1.5 text-[11px] font-medium transition-colors h-8 px-2.5 rounded-lg",
                saving || !token.trim()
                  ? "text-text-tertiary cursor-not-allowed"
                  : saved
                    ? "text-accent-green bg-accent-green/8"
                    : "text-accent-blue hover:bg-accent-blue/8"
              )}
            >
              {saving ? (
                <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
              ) : saved ? (
                <Check size={12} strokeWidth={2} />
              ) : null}
              {saved ? "Saved to Keychain" : "Save to Keychain"}
            </button>
            {hasToken && (
              <button
                onClick={handleDeleteToken}
                className="flex items-center gap-1 text-[11px] text-accent-red/60 hover:text-accent-red h-8 px-2 rounded-lg hover:bg-accent-red/8 transition-colors"
              >
                <Trash2 size={12} strokeWidth={1.75} />
                Remove
              </button>
            )}
          </div>
        </div>

        {/* Hotkey */}
        <div className="glass-card-static rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-white/[0.05]">
              <Keyboard size={14} strokeWidth={1.75} className="text-text-secondary" />
            </div>
            <span className="text-[13px] font-semibold text-text-secondary">Global Hotkey</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-text-primary">Toggle Panel</span>
            <kbd className="text-[11px] text-text-secondary font-mono bg-white/[0.05] px-2 py-1 rounded-lg border border-border">
              {"\u2318"}{"\u21E7"}R
            </kbd>
          </div>
        </div>

        {/* About */}
        <div className="glass-card-static rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-white/[0.05]">
              <Info size={14} strokeWidth={1.75} className="text-text-secondary" />
            </div>
            <span className="text-[13px] font-semibold text-text-secondary">About</span>
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] text-text-primary">RouteBox Desktop</span>
            <span className="text-[11px] text-text-tertiary font-mono">v0.1.0</span>
          </div>
          <button
            onClick={handleQuit}
            className="w-full text-[13px] font-medium text-accent-red/70 hover:text-accent-red bg-accent-red/6 hover:bg-accent-red/10 h-8 rounded-lg transition-colors"
          >
            Quit RouteBox
          </button>
        </div>
      </div>
    </>
  );
}
