import { useState, useEffect, useCallback } from "react";
import { Check, Loader2, Trash2, ChevronRight, X, Play, Square, Download, RefreshCw, Globe, Server, Wifi, Sun, Moon, ArrowRight } from "lucide-react";
import clsx from "clsx";
import {
  getGatewayUrl,
  setGatewayUrl as setGatewayUrlGlobal,
  setAuthToken,
  setCloudAuthToken,
  getPortFromUrl,
  isLocalGatewayUrl,
  getGatewayMode,
  setGatewayMode,
  ROUTEBOX_CLOUD_URL,
  type GatewayMode,
} from "@/lib/constants";
import { checkGatewayHealth } from "@/lib/gateway-health";
import { api } from "@/lib/api";

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
}

export function Settings({ onClose }: SettingsProps) {
  const [activeMode, setActiveMode] = useState<GatewayMode>(getGatewayMode);
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetSaved, setBudgetSaved] = useState(false);
  const [budgetError, setBudgetError] = useState(false);
  const [autoStartGateway, setAutoStartGateway] = useState(true);
  const [gwRunning, setGwRunning] = useState(false);
  const [gwLoading, setGwLoading] = useState(false);
  const [gwError, setGwError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [updateState, setUpdateState] = useState<
    "idle" | "checking" | "upToDate" | "available" | "downloading" | "ready"
  >("idle");
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [searchKey, setSearchKey] = useState("");
  const [searchHasKey, setSearchHasKey] = useState(false);
  const [searchSaving, setSearchSaving] = useState(false);
  const [searchSaved, setSearchSaved] = useState(false);
  // Cloud read-only info
  const [cloudUser, setCloudUser] = useState<{ email: string; plan: string } | null>(null);

  // Theme state
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (document.documentElement.dataset.theme as "dark" | "light") || "dark"
  );

  const handleSetTheme = useCallback(async (t: "dark" | "light") => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try {
      const store = await loadStore();
      await store.set("theme", t);
    } catch {}
  }, []);

  useEffect(() => {
    tauriInvoke<string>("get_token")
      .then((t) => {
        if (t) {
          setToken(t);
          setHasToken(true);
        }
      })
      .catch(() => {});

    // Load cloud user info for read-only display
    if (getGatewayMode() === "cloud") {
      tauriInvoke<string>("get_cloud_token")
        .then((t) => {
          if (t) {
            setCloudAuthToken(t);
            api.cloudGetMe()
              .then((res) => setCloudUser({ email: res.user.email, plan: res.user.plan }))
              .catch(() => {});
          }
        })
        .catch(() => {});
    }

    loadStore()
      .then(async (store) => {
        const auto = await store.get<boolean>("gatewayAutoStart");
        setAutoStartGateway(auto !== false);
      })
      .catch(() => {});

    api.getBudget()
      .then((res) => {
        if (res.monthly > 0) setBudgetAmount(String(res.monthly));
      })
      .catch(() => {});

    api.getSearchStatus()
      .then((res) => setSearchHasKey(res.hasKey))
      .catch(() => {});

    checkGatewayHealth(getGatewayUrl())
      .then(setGwRunning)
      .catch(() => {});

    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  // Load cloud user when switching to cloud mode
  useEffect(() => {
    if (activeMode !== "cloud") return;
    api.cloudGetMe()
      .then((res) => setCloudUser({ email: res.user.email, plan: res.user.plan }))
      .catch(() => setCloudUser(null));
  }, [activeMode]);

  const handleSwitchMode = useCallback(async (mode: GatewayMode) => {
    setActiveMode(mode);
    setGatewayMode(mode);
    const newUrl = mode === "cloud" ? ROUTEBOX_CLOUD_URL : "http://localhost:3001";
    setGatewayUrlGlobal(newUrl);
    try {
      const store = await loadStore();
      await store.set("gatewayMode", mode);
      await store.set("gatewayUrl", newUrl);
    } catch {}

    if (mode === "local") {
      // Spawn local gateway if not running
      const healthy = await checkGatewayHealth(newUrl).catch(() => false);
      if (!healthy) {
        try {
          await tauriInvoke("spawn_gateway", { port: getPortFromUrl(newUrl) });
          const t = await tauriInvoke<string>("get_token");
          if (t) { setAuthToken(t); setToken(t); setHasToken(true); }
          setGwRunning(true);
        } catch (err) {
          setGwError(err instanceof Error ? err.message : String(err));
        }
      } else {
        setGwRunning(true);
      }
    }
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
    setBudgetError(false);
    try {
      await api.setBudget(amount);
      setBudgetSaved(true);
      setTimeout(() => setBudgetSaved(false), 2000);
    } catch {
      setBudgetError(true);
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
      const isLocal = isLocalGatewayUrl();

      if (isLocal) {
        await tauriInvoke("spawn_gateway", { port: getPortFromUrl(url) });
        await new Promise((r) => setTimeout(r, 1500));
      }

      const healthy = await checkGatewayHealth(url);
      setGwRunning(healthy);
      if (!healthy) {
        setGwError(
          isLocal
            ? "Gateway process started but health check failed. Is bun installed?"
            : `Cannot connect to ${url}. Check the URL and try again.`,
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
      const isLocal = isLocalGatewayUrl();
      if (isLocal) {
        await tauriInvoke("stop_gateway");
      }
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

  const handleSaveSearchKey = useCallback(async () => {
    if (!searchKey.trim()) return;
    setSearchSaving(true);
    try {
      await api.setSearchKey(searchKey.trim());
      setSearchHasKey(true);
      setSearchSaved(true);
      setSearchKey("");
      setTimeout(() => setSearchSaved(false), 2000);
    } catch {}
    setSearchSaving(false);
  }, [searchKey]);

  const handleDeleteSearchKey = useCallback(async () => {
    try {
      await api.deleteSearchKey();
      setSearchHasKey(false);
      setSearchKey("");
    } catch {}
  }, []);

  const handleRelaunch = useCallback(async () => {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {}
  }, []);

  const handleQuit = useCallback(async () => {
    try {
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
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative mt-auto glass-card rounded-b-none animate-slide-up max-h-[85%] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-11 border-b border-border-light shrink-0">
          <h2 className="text-[14px] font-semibold text-text-primary">Settings</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-hover-overlay transition-colors"
          >
            <X size={14} strokeWidth={1.75} className="text-text-tertiary" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

          {/* Appearance */}
          <div>
            <h3 className="section-header">Appearance</h3>
            <div className="flex gap-1.5 p-1 bg-bg-input rounded-xl">
              <button
                onClick={() => handleSetTheme("dark")}
                className={clsx(
                  "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-[12px] font-medium transition-colors",
                  theme === "dark"
                    ? "bg-bg-elevated shadow-sm text-text-primary"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <Moon size={13} strokeWidth={1.75} />
                Dark
              </button>
              <button
                onClick={() => handleSetTheme("light")}
                className={clsx(
                  "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-[12px] font-medium transition-colors",
                  theme === "light"
                    ? "bg-bg-elevated shadow-sm text-text-primary"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <Sun size={13} strokeWidth={1.75} />
                Light
              </button>
            </div>
          </div>

          {/* Gateway Mode Switcher */}
          <div>
            <h3 className="section-header">Gateway Mode</h3>
            <div className="flex gap-1.5 p-1 bg-bg-input rounded-xl">
              <button
                onClick={() => handleSwitchMode("local")}
                className={clsx(
                  "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-[12px] font-medium transition-colors",
                  activeMode === "local"
                    ? "bg-bg-elevated shadow-sm text-text-primary"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <Server size={13} strokeWidth={1.75} />
                Local Gateway
              </button>
              <button
                onClick={() => handleSwitchMode("cloud")}
                className={clsx(
                  "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-[12px] font-medium transition-colors",
                  activeMode === "cloud"
                    ? "bg-bg-elevated shadow-sm text-text-primary"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                <Wifi size={13} strokeWidth={1.75} />
                Cloud Gateway
              </button>
            </div>
          </div>

          {/* LOCAL MODE PANEL */}
          {activeMode === "local" && (
            <>
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
                        autoStartGateway ? "bg-accent-green" : "bg-toggle-off"
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
                        gwRunning ? "bg-accent-green" : gwError ? "bg-accent-red" : "bg-dot-offline"
                      )} />
                      <span className="text-[11px] text-text-secondary">
                        {gwLoading ? "Connecting\u2026" : gwRunning ? "Running" : "Stopped"}
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
                          ) : (
                            <Play size={12} strokeWidth={2} />
                          )}
                          Start
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
                          Stop
                        </button>
                      )}
                    </div>
                  </div>
                  {gwError && (
                    <p className="text-[10px] text-accent-red">{gwError}</p>
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
            </>
          )}

          {/* CLOUD MODE — read-only info */}
          {activeMode === "cloud" && (
            <div>
              <h3 className="section-header">Cloud Account</h3>
              <div className="glass-card-static p-3">
                {cloudUser ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] text-text-primary font-medium">{cloudUser.email}</p>
                      <p className="text-[10px] text-text-tertiary capitalize">{cloudUser.plan} plan</p>
                    </div>
                    <button
                      onClick={onClose}
                      className="flex items-center gap-1 text-[11px] text-accent-cyan hover:bg-accent-cyan/10 h-7 px-2 rounded-lg transition-colors"
                    >
                      Go to Activity
                      <ArrowRight size={12} strokeWidth={1.75} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] text-text-secondary">Not signed in</p>
                    <button
                      onClick={onClose}
                      className="flex items-center gap-1 text-[11px] text-accent-cyan hover:bg-accent-cyan/10 h-7 px-2 rounded-lg transition-colors"
                    >
                      Sign in via Activity
                      <ArrowRight size={12} strokeWidth={1.75} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Budget */}
          <div>
            <h3 className="section-header">Budget</h3>
            <div className="glass-card-static p-3">
              <label className="block text-[11px] text-text-tertiary font-medium mb-1.5">Monthly Limit (USD)</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    value={budgetAmount}
                    onChange={(e) => { setBudgetAmount(e.target.value); setBudgetSaved(false); setBudgetError(false); }}
                    placeholder="0 (disabled)"
                    min="0"
                    step="1"
                    className="input w-full"
                  />
                  {budgetError && (
                    <div
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-accent-red"
                      title="Failed to save budget"
                    />
                  )}
                </div>
                <button
                  onClick={handleSaveBudget}
                  disabled={budgetSaving}
                  className={clsx(
                    "flex items-center gap-1 text-[11px] font-medium h-8 px-2.5 rounded-lg transition-colors",
                    budgetSaved
                      ? "text-accent-green bg-accent-green/10"
                      : budgetError
                        ? "text-accent-red hover:bg-accent-red/10"
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
              {budgetError && (
                <p className="mt-1.5 text-[10px] text-accent-red">Failed to save budget limit.</p>
              )}
              <p className="mt-1.5 text-[10px] text-text-tertiary">
                Alerts at 80% and 100%. Set to 0 to disable.
              </p>
            </div>
          </div>

          {/* Web Search */}
          <div>
            <h3 className="section-header">Web Search</h3>
            <div className="glass-card-static p-3">
              <div className="flex items-center gap-2 mb-2">
                <Globe size={14} strokeWidth={1.75} className="text-text-tertiary" />
                <span className="text-[13px] text-text-primary font-medium">Brave Search</span>
                {searchHasKey && (
                  <span className="text-[10px] text-accent-green bg-accent-green/10 px-1.5 py-0.5 rounded-md font-medium">
                    Active
                  </span>
                )}
              </div>
              {!searchHasKey && (
                <p className="text-[11px] text-text-secondary mb-2 leading-relaxed">
                  Add a Brave Search API key to enable web search in Chat and Spotlight.
                  Get a free key at{" "}
                  <span className="text-accent-cyan font-mono text-[10px]">brave.com/search/api</span>
                </p>
              )}
              <label className="block text-[11px] text-text-tertiary font-medium mb-1.5">
                {searchHasKey ? "API Key configured" : "Brave Search API Key"}
              </label>
              <input
                type="password"
                value={searchKey}
                onChange={(e) => { setSearchKey(e.target.value); setSearchSaved(false); }}
                placeholder={searchHasKey ? "Key saved \u2022 paste new to replace" : "BSA-xxxxxxxxxxxxxxxx"}
                className="input"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={handleSaveSearchKey}
                  disabled={searchSaving || !searchKey.trim()}
                  className={clsx(
                    "flex items-center gap-1 text-[11px] font-medium h-8 px-2.5 rounded-lg transition-colors",
                    searchSaving || !searchKey.trim()
                      ? "text-text-tertiary cursor-not-allowed"
                      : searchSaved
                        ? "text-accent-green bg-accent-green/10"
                        : "text-accent-cyan hover:bg-accent-cyan/10"
                  )}
                >
                  {searchSaving ? (
                    <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                  ) : searchSaved ? (
                    <Check size={12} strokeWidth={2} />
                  ) : null}
                  {searchSaved ? "Saved" : "Save"}
                </button>
                {searchHasKey && (
                  <button
                    onClick={handleDeleteSearchKey}
                    className="flex items-center gap-1 text-[11px] text-accent-red/60 hover:text-accent-red h-8 px-2 rounded-lg hover:bg-accent-red/10 transition-colors"
                  >
                    <Trash2 size={12} strokeWidth={1.75} />
                    Remove
                  </button>
                )}
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
                  {updateState === "checking" && "Checking for updates\u2026"}
                  {updateState === "downloading" && "Downloading update\u2026"}
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
