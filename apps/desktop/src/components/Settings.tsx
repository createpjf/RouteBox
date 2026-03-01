import { useState, useEffect, useCallback } from "react";
import { Check, Loader2, Trash2, ChevronRight, X, BookOpen, Play, Square, Download, RefreshCw, Wifi } from "lucide-react";
import clsx from "clsx";
import { getGatewayUrl, setGatewayUrl as setGatewayUrlGlobal, setAuthToken, getPortFromUrl } from "@/lib/constants";
import { checkGatewayHealth } from "@/lib/gateway-health";
import { isLocalGatewayUrl } from "@/lib/gateway-health";
import { api } from "@/lib/api";
import { ProviderKeyManager } from "./ProviderKeyManager";

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function loadStore() {
  const { load } = await import("@tauri-apps/plugin-store");
  return load("settings.json", { defaults: {}, autoSave: true });
}

interface SettingsProps {
  onClose: () => void;
  onShowOnboarding?: () => void;
}

export function Settings({ onClose, onShowOnboarding }: SettingsProps) {
  const [gatewayUrl, setGatewayUrl] = useState(getGatewayUrl);
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetSaved, setBudgetSaved] = useState(false);
  const [autoStartGateway, setAutoStartGateway] = useState(true);
  const [gwRunning, setGwRunning] = useState(false);
  const [gwLoading, setGwLoading] = useState(false);
  const [gwError, setGwError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [updateState, setUpdateState] = useState<
    "idle" | "checking" | "upToDate" | "available" | "downloading" | "ready"
  >("idle");
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    tauriInvoke<string>("get_token")
      .then((t) => {
        if (t) {
          setToken(t);
          setHasToken(true);
        }
      })
      .catch(() => {});

    // Single store load for both gatewayUrl and gatewayAutoStart
    loadStore()
      .then(async (store) => {
        const url = await store.get<string>("gatewayUrl");
        if (url) {
          setGatewayUrl(url);
          setGatewayUrlGlobal(url);
        }
        const auto = await store.get<boolean>("gatewayAutoStart");
        setAutoStartGateway(auto !== false);
      })
      .catch(() => {});

    api.getBudget()
      .then((res) => {
        if (res.monthly > 0) setBudgetAmount(String(res.monthly));
      })
      .catch(() => {});

    // Gateway state — single HTTP health check (works for both spawned and external gateways)
    checkGatewayHealth(getGatewayUrl())
      .then(setGwRunning)
      .catch(() => {});

    // Load app version
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
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

  const handleSaveBudget = useCallback(async () => {
    const amount = parseFloat(budgetAmount) || 0;
    setBudgetSaving(true);
    try {
      await api.setBudget(amount);
      setBudgetSaved(true);
      setTimeout(() => setBudgetSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setBudgetSaving(false);
    }
  }, [budgetAmount]);

  const handleToggleAutoStart = useCallback(async (enabled: boolean) => {
    setAutoStartGateway(enabled);
    try {
      const store = await loadStore();
      await store.set("gatewayAutoStart", enabled);
    } catch {}
  }, []);

  const handleStartGateway = useCallback(async () => {
    setGwLoading(true);
    setGwError(null);
    try {
      const url = getGatewayUrl();
      const isLocal = isLocalGatewayUrl(url);

      if (isLocal) {
        // Local gateway: spawn bun process, then health check
        await tauriInvoke("spawn_gateway", { port: getPortFromUrl(url) });
        await new Promise((r) => setTimeout(r, 1500));
      }

      // Health check (works for both local and remote gateways)
      const healthy = await checkGatewayHealth(url);
      setGwRunning(healthy);
      if (!healthy) {
        setGwError(
          isLocal
            ? "Gateway process started but health check failed. Is bun installed?"
            : `Cannot connect to ${url}. Check the URL and try again.`
        );
      }
    } catch (err) {
      setGwError(err instanceof Error ? err.message : String(err));
    }
    setGwLoading(false);
  }, []);

  const handleStopGateway = useCallback(async () => {
    setGwLoading(true);
    setGwError(null);
    try {
      const isLocal = isLocalGatewayUrl(getGatewayUrl());
      if (isLocal) {
        // Local gateway: kill the bun process
        await tauriInvoke("stop_gateway");
      }
      // Both local and remote: mark as disconnected
      setGwRunning(false);
    } catch (err) {
      setGwError(err instanceof Error ? err.message : String(err));
    }
    setGwLoading(false);
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    setUpdateState("checking");
    setUpdateError(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        setUpdateState("available");
        // Auto-download and install
        setUpdateState("downloading");
        await update.downloadAndInstall();
        setUpdateState("ready");
      } else {
        setUpdateState("upToDate");
        setTimeout(() => setUpdateState("idle"), 3000);
      }
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Update check failed");
      setUpdateState("idle");
    }
  }, []);

  const handleRelaunch = useCallback(async () => {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      // fallback — shouldn't happen
    }
  }, []);

  const handleQuit = useCallback(async () => {
    try {
      // Stop gateway process before exiting to prevent orphaned processes
      await tauriInvoke("stop_gateway").catch(() => {});
      const { exit } = await import("@tauri-apps/plugin-process");
      await exit(0);
    } catch {
      window.close();
    }
  }, []);

  return (
    <div className="absolute inset-0 z-40 flex flex-col">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative mt-auto glass-card rounded-b-none animate-slide-up max-h-[85%] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-11 border-b border-border-light shrink-0">
          <h2 className="text-[14px] font-semibold text-text-primary">Settings</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-bg-card transition-colors"
          >
            <X size={14} strokeWidth={1.75} className="text-text-tertiary" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Providers */}
          <div>
            <h3 className="section-header">Providers</h3>
            <ProviderKeyManager />
          </div>

          {/* Budget */}
          <div>
            <h3 className="section-header">Budget</h3>
            <div className="glass-card-static p-3">
              <label className="block text-[11px] text-text-tertiary font-medium mb-1.5">Monthly Limit (USD)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={budgetAmount}
                  onChange={(e) => { setBudgetAmount(e.target.value); setBudgetSaved(false); }}
                  placeholder="0 (disabled)"
                  min="0"
                  step="1"
                  className="input flex-1"
                />
                <button
                  onClick={handleSaveBudget}
                  disabled={budgetSaving}
                  className={clsx(
                    "flex items-center gap-1 text-[11px] font-medium h-8 px-2.5 rounded-lg transition-colors",
                    budgetSaved
                      ? "text-accent-green bg-accent-green/10"
                      : "text-accent-cyan hover:bg-accent-cyan/10"
                  )}
                >
                  {budgetSaving ? (
                    <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                  ) : budgetSaved ? (
                    <Check size={12} strokeWidth={2} />
                  ) : null}
                  {budgetSaved ? "Saved" : "Save"}
                </button>
              </div>
              <p className="mt-1.5 text-[10px] text-text-tertiary">
                Alerts at 80% and 100%. Set to 0 to disable.
              </p>
            </div>
          </div>

          {/* Gateway */}
          <div>
            <h3 className="section-header">Gateway</h3>
            <div className="glass-card-static p-3 space-y-2.5">
              {/* Auto-start toggle */}
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-text-primary">Auto-start on launch</span>
                <button
                  onClick={() => handleToggleAutoStart(!autoStartGateway)}
                  className={clsx(
                    "relative w-10 h-[22px] rounded-full transition-colors",
                    autoStartGateway ? "bg-accent-green" : "bg-[#D1D1D6]"
                  )}
                >
                  <div
                    className={clsx(
                      "absolute top-[2px] w-[18px] h-[18px] bg-white rounded-full shadow-sm transition-transform",
                      autoStartGateway ? "translate-x-[20px]" : "translate-x-[2px]"
                    )}
                  />
                </button>
              </div>

              {/* Status + manual controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className={clsx(
                    "h-2 w-2 rounded-full",
                    gwRunning ? "bg-accent-green" : gwError ? "bg-accent-red" : "bg-[#C7C7CC]"
                  )} />
                  <span className="text-[11px] text-text-secondary">
                    {gwLoading ? "Connecting…" : gwRunning ? (isLocalGatewayUrl(gatewayUrl) ? "Running" : "Connected") : "Stopped"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {!gwRunning ? (
                    <button
                      onClick={handleStartGateway}
                      disabled={gwLoading}
                      className="flex items-center gap-1 text-[11px] text-accent-green hover:bg-accent-green/10 h-7 px-2 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {gwLoading ? (
                        <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                      ) : isLocalGatewayUrl(gatewayUrl) ? (
                        <Play size={12} strokeWidth={2} />
                      ) : (
                        <Wifi size={12} strokeWidth={2} />
                      )}
                      {isLocalGatewayUrl(gatewayUrl) ? "Start" : "Connect"}
                    </button>
                  ) : (
                    <button
                      onClick={handleStopGateway}
                      disabled={gwLoading}
                      className="flex items-center gap-1 text-[11px] text-accent-red hover:bg-accent-red/10 h-7 px-2 rounded-lg transition-colors disabled:opacity-40"
                    >
                      {gwLoading ? (
                        <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                      ) : (
                        <Square size={12} strokeWidth={2} />
                      )}
                      {isLocalGatewayUrl(gatewayUrl) ? "Stop" : "Disconnect"}
                    </button>
                  )}
                </div>
              </div>
              {gwError && (
                <p className="text-[10px] text-accent-red">{gwError}</p>
              )}
            </div>
          </div>

          {/* Connection */}
          <div>
            <h3 className="section-header">Connection</h3>
            <div className="glass-card-static p-3">
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
                className={clsx("input input-mono", urlError && "!border-accent-red")}
              />
              {urlError && (
                <p className="mt-1 text-[11px] text-accent-red">{urlError}</p>
              )}
            </div>
          </div>

          {/* Authentication */}
          <div>
            <h3 className="section-header">Authentication</h3>
            <div className="glass-card-static p-3">
              {!hasToken && (
                <p className="text-[11px] text-text-secondary mb-2.5 leading-relaxed">
                  Your gateway auto-generates an auth token on first run. Find it in
                  the gateway logs or <span className="font-mono text-text-tertiary">.env</span> file,
                  then paste it below to connect.
                </p>
              )}
              <label className="block text-[11px] text-text-tertiary font-medium mb-1.5">Gateway Auth Token</label>
              <input
                type="password"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setSaved(false);
                }}
                placeholder={hasToken ? "Token saved in Keychain" : "Paste your gateway auth token"}
                className="input"
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
                        ? "text-accent-green bg-accent-green/10"
                        : "text-accent-cyan hover:bg-accent-cyan/10"
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
                    className="flex items-center gap-1 text-[11px] text-accent-red/60 hover:text-accent-red h-8 px-2 rounded-lg hover:bg-accent-red/10 transition-colors"
                  >
                    <Trash2 size={12} strokeWidth={1.75} />
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Shortcuts */}
          <div>
            <h3 className="section-header">Shortcuts</h3>
            <div className="glass-card-static overflow-hidden">
              <div className="flex items-center justify-between h-9 px-3 border-b border-border-light">
                <span className="text-[13px] text-text-primary">Toggle Panel</span>
                <kbd className="text-[10px] text-text-tertiary font-mono bg-bg-input px-1.5 py-0.5 rounded-md border border-border">
                  {"\u2318"}{"\u21E7"}R
                </kbd>
              </div>
              <div className="flex items-center justify-between h-9 px-3 border-b border-border-light">
                <span className="text-[13px] text-text-primary">Copy API Key</span>
                <kbd className="text-[10px] text-text-tertiary font-mono bg-bg-input px-1.5 py-0.5 rounded-md border border-border">
                  {"\u2318"}C
                </kbd>
              </div>
              <div className="flex items-center justify-between h-9 px-3">
                <span className="text-[13px] text-text-primary">Pause Traffic</span>
                <kbd className="text-[10px] text-text-tertiary font-mono bg-bg-input px-1.5 py-0.5 rounded-md border border-border">
                  {"\u2318"}P
                </kbd>
              </div>
            </div>
          </div>

          {/* About */}
          <div>
            <h3 className="section-header">About</h3>
            <div className="glass-card-static overflow-hidden">
              <div className="flex items-center justify-between h-9 px-3 border-b border-border-light">
                <span className="text-[13px] text-text-primary">RouteBox Desktop</span>
                <span className="text-[11px] text-text-tertiary font-mono">v{appVersion}</span>
              </div>

              {/* Check for Updates */}
              <button
                onClick={updateState === "ready" ? handleRelaunch : handleCheckUpdate}
                disabled={updateState === "checking" || updateState === "downloading"}
                className={clsx(
                  "flex items-center justify-between w-full h-9 px-3 text-[13px] transition-colors border-b border-border-light",
                  updateState === "ready"
                    ? "text-accent-green hover:bg-accent-green/10"
                    : "text-text-primary hover:bg-bg-row-hover",
                  (updateState === "checking" || updateState === "downloading") && "opacity-60 cursor-not-allowed"
                )}
              >
                <span className="flex items-center gap-2">
                  {(updateState === "checking" || updateState === "downloading") ? (
                    <Loader2 size={14} strokeWidth={1.75} className="animate-spin text-text-tertiary" />
                  ) : updateState === "upToDate" ? (
                    <Check size={14} strokeWidth={2} className="text-accent-green" />
                  ) : updateState === "ready" ? (
                    <RefreshCw size={14} strokeWidth={1.75} className="text-accent-green" />
                  ) : (
                    <Download size={14} strokeWidth={1.75} className="text-text-tertiary" />
                  )}
                  {updateState === "checking" && "Checking for updates…"}
                  {updateState === "downloading" && "Downloading update…"}
                  {updateState === "upToDate" && "You're up to date"}
                  {updateState === "available" && "Update available"}
                  {updateState === "ready" && "Restart to update"}
                  {updateState === "idle" && "Check for Updates"}
                </span>
                {updateState === "idle" && (
                  <ChevronRight size={14} strokeWidth={1.75} className="text-text-tertiary" />
                )}
              </button>
              {updateError && (
                <div className="px-3 py-1.5 border-b border-border-light">
                  <p className="text-[10px] text-accent-red">{updateError}</p>
                </div>
              )}

              {onShowOnboarding && (
                <button
                  onClick={() => {
                    onClose();
                    onShowOnboarding();
                  }}
                  className="flex items-center justify-between w-full h-9 px-3 text-[13px] text-text-primary hover:bg-bg-row-hover transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <BookOpen size={14} strokeWidth={1.75} className="text-text-tertiary" />
                    Setup Guide
                  </span>
                  <ChevronRight size={14} strokeWidth={1.75} className="text-text-tertiary" />
                </button>
              )}
            </div>
          </div>

          {/* Quit */}
          <button
            onClick={handleQuit}
            className="w-full text-[13px] font-medium text-accent-red border border-accent-red/20 hover:bg-accent-red/10 h-9 rounded-xl transition-colors"
          >
            Quit RouteBox
          </button>
        </div>
      </div>
    </div>
  );
}
