import { useState, useEffect, useCallback, useRef } from "react";
import { Panel } from "@/components/Panel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HeroSection } from "@/components/HeroSection";
import { HomePage } from "@/components/HomePage";
import { RoutingPage } from "@/components/RoutingPage";
import { ActivityPage } from "@/components/ActivityPage";
import { AccountPage } from "@/components/AccountPage";
import { TabBar } from "@/components/TabBar";
import type { TabId } from "@/components/TabBar";
import { Settings } from "@/components/Settings";
import { Onboarding } from "@/components/Onboarding";
import { RequestDetail } from "@/components/RequestDetail";
import { AlertBanner } from "@/components/AlertBanner";
import { ToastContainer } from "@/components/ToastContainer";
import { useRealtimeStats } from "@/hooks/useRealtimeStats";
import { useToast } from "@/hooks/useToast";
import { getGatewayUrl, setGatewayUrl, setAuthToken, setCloudAuthToken, setGatewayMode, getGatewayMode, getCloudAuthToken, getPortFromUrl, ROUTEBOX_CLOUD_URL } from "@/lib/constants";
import { checkGatewayHealth, waitForGateway, isLocalGatewayUrl } from "@/lib/gateway-health";
import { api } from "@/lib/api";
import type { CloudAnnouncement } from "@/lib/api";
import type { RealtimeStats, RequestLogEntry } from "@/types/stats";

type GatewayState = "idle" | "checking" | "starting" | "running" | "failed";

const EMPTY_STATS: RealtimeStats = {
  requests: 0, tokens: 0, cost: 0, saved: 0,
  requestsDelta: 0, tokensDelta: 0, costDelta: 0,
  sparkline: [], providers: [], balance: 0,
  budget: 0, monthSpend: 0,
};

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(true); // default true to prevent flash
  const [selectedRequest, setSelectedRequest] = useState<RequestLogEntry | null>(null);
  const [gatewayState, setGatewayState] = useState<GatewayState>("idle");
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [token, setToken] = useState("");
  const [cloudAnnouncement, setCloudAnnouncement] = useState<CloudAnnouncement | null>(null);
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);
  const [gatewayRunningAt, setGatewayRunningAt] = useState(0);
  const { stats, connected, stale, history, requestLog, alert, dismissAlert } = useRealtimeStats(tokenLoaded);
  const { toasts, showToast, dismissToast } = useToast();

  // Load persisted settings before any API calls
  useEffect(() => {
    async function loadSettings() {
      try {
        const { load } = await import("@tauri-apps/plugin-store");
        const store = await load("settings.json", { defaults: {} });

        const mode = await store.get<string>("gatewayMode");
        const savedMode = mode === "cloud" ? "cloud" : "local";
        setGatewayMode(savedMode);

        const url = await store.get<string>("gatewayUrl");
        if (url) {
          setGatewayUrl(url);
        } else {
          // Apply default URL based on mode
          setGatewayUrl(savedMode === "cloud" ? ROUTEBOX_CLOUD_URL : "http://localhost:3001");
        }

        const dismissed = await store.get<boolean>("onboardingDismissed");
        setOnboardingDismissed(!!dismissed);

        // Load the appropriate token based on mode
        const { invoke } = await import("@tauri-apps/api/core");
        if (savedMode === "cloud") {
          try {
            const t = await invoke<string>("get_cloud_token");
            if (t) { setCloudAuthToken(t); setToken(t); }
          } catch {}
        } else {
          try {
            const t = await invoke<string>("get_token");
            if (t) { setAuthToken(t); setToken(t); }
          } catch {}
        }
      } catch {
        // Not in Tauri
        setOnboardingDismissed(false);
      } finally {
        setSettingsLoaded(true);
      }
    }

    loadSettings();
  }, []);

  // Gateway auto-start — waits for settings to be loaded first
  useEffect(() => {
    if (!settingsLoaded) return;

    let cancelled = false;

    async function autoStartGateway() {
      try {
        const { load } = await import("@tauri-apps/plugin-store");
        const store = await load("settings.json", { defaults: {} });
        const autoStart = await store.get<boolean>("gatewayAutoStart");
        // First launch: persist default (true) so Settings toggle stays in sync
        if (autoStart === undefined || autoStart === null) {
          await store.set("gatewayAutoStart", true);
        }
        if (autoStart === false) {
          setTokenLoaded(true);
          return;
        }

        const url = getGatewayUrl();
        const currentMode = getGatewayMode();
        const isLocal = currentMode === "local" && isLocalGatewayUrl(url);
        setGatewayState("checking");

        // Already running / reachable?
        if (await checkGatewayHealth(url)) {
          if (!cancelled) setGatewayState("running");
          setTokenLoaded(true);
          return;
        }

        if (isLocal) {
          // Local gateway: spawn bun process
          if (!cancelled) setGatewayState("starting");
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("spawn_gateway", { port: getPortFromUrl(url) });

          // Reload token from keychain (spawn_gateway generates it if needed)
          try {
            const t = await invoke<string>("get_token");
            if (t) { setAuthToken(t); setToken(t); }
          } catch {}

          // Wait for health
          const healthy = await waitForGateway(url, 12_000, 500);
          if (!cancelled) {
            setGatewayState(healthy ? "running" : "failed");
          }
        } else {
          // Remote gateway: health-check miss is not a hard failure — stay idle
          if (!cancelled) setGatewayState("idle");
        }
      } catch (err) {
        console.error("[RouteBox] auto-start failed:", err);
        if (!cancelled) {
          setGatewayState("failed");
          setGatewayError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setTokenLoaded(true);
      }
    }

    autoStartGateway();
    return () => { cancelled = true; };
  }, [settingsLoaded]);

  // Upgrade gateway state when WS connects
  useEffect(() => {
    if (connected && gatewayState !== "running") {
      setGatewayState("running");
      setGatewayError(null);
    }
  }, [connected, gatewayState]);

  // Track when gateway transitions to running so ActivityPage can refetch providers
  useEffect(() => {
    if (gatewayState === "running") setGatewayRunningAt(Date.now());
  }, [gatewayState]);

  // Fetch cloud announcement once token is loaded (cloud mode only)
  useEffect(() => {
    if (!tokenLoaded) return;
    const mode = getGatewayMode();
    if (mode !== "cloud" || !getCloudAuthToken()) return;

    api.cloudGetAnnouncement().then((res) => {
      if (res.announcement) {
        setCloudAnnouncement(res.announcement);
        setAnnouncementDismissed(false);
      }
    }).catch(() => {
      // Best-effort — silent on failure
    });
  }, [tokenLoaded]);

  // Auto-show onboarding for first-run users (only needs tokenLoaded, not connected)
  useEffect(() => {
    if (!tokenLoaded || onboardingDismissed || showSettings) return;
    const mode = getGatewayMode();
    if (mode === "cloud") {
      // Cloud mode: skip onboarding if already logged in
      if (getCloudAuthToken()) return;
      setShowOnboarding(true);
    } else {
      const hasProviders = (stats?.providers.length ?? 0) > 0;
      if (!hasProviders) setShowOnboarding(true);
    }
  }, [tokenLoaded, stats, onboardingDismissed, showSettings]);

  // Auto-check for updates on startup (once, 5s delay)
  const updateCheckedRef = useRef(false);
  useEffect(() => {
    if (updateCheckedRef.current || gatewayState !== "running") return;
    updateCheckedRef.current = true;
    const timer = setTimeout(async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (update) {
          showToast(`New version available! Open Settings → About to update.`, "info", 8000);
        }
      } catch {
        // Silent — update check is best-effort
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [gatewayState, showToast]);

  const handleCloudLoginSuccess = useCallback(async () => {
    setOnboardingDismissed(true);
    setShowOnboarding(false);
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("settings.json", { defaults: {} });
      await store.set("onboardingDismissed", true);
    } catch {
      // Not in Tauri — no persistence
    }
    setGatewayState("checking");
    setGatewayError(null);
    const { checkGatewayHealth: check } = await import("@/lib/gateway-health");
    const healthy = await check(getGatewayUrl());
    setGatewayState(healthy ? "running" : "idle");
  }, []);

  const handleDismissOnboarding = useCallback(async () => {
    setShowOnboarding(false);
    setOnboardingDismissed(true);
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("settings.json", { defaults: {} });
      await store.set("onboardingDismissed", true);
    } catch {
      // Not in Tauri — no persistence
    }
  }, []);

  const currentStats = stats ?? EMPTY_STATS;
  const hasProviders = currentStats.providers.length > 0;

  return (
    <Panel>
      <ErrorBoundary>
        <HeroSection
          connected={connected}
          stale={stale}
          gatewayState={gatewayState}
          gatewayError={gatewayError}
          onOpenSettings={() => setShowSettings(true)}
          onOpenChat={() => {
            import("@tauri-apps/api/core").then(({ invoke }) => invoke("open_chat")).catch(() => {});
          }}
          onShowOnboarding={() => {
            setShowOnboarding(true);
            setOnboardingDismissed(false);
          }}
        />
        {alert && (
          <AlertBanner
            title={alert.title}
            message={alert.message}
            onDismiss={dismissAlert}
          />
        )}
        {!alert && cloudAnnouncement && !announcementDismissed && (
          <AlertBanner
            title={cloudAnnouncement.title}
            message={cloudAnnouncement.message}
            onDismiss={() => setAnnouncementDismissed(true)}
          />
        )}
        <div className="flex flex-1 min-h-0 relative">
          {(["home", "routing", "activity", "account"] as const).map((tab) => (
            <div
              key={tab}
              className={tab === activeTab
                ? "flex flex-1 min-h-0 absolute inset-0 animate-page-in"
                : "hidden"}
            >
              {tab === "home"     && <HomePage stats={currentStats} history={history} />}
              {tab === "routing"  && <RoutingPage stats={currentStats} showToast={showToast} />}
              {tab === "activity" && (
                <ActivityPage
                  requestLog={requestLog}
                  onSelectEntry={setSelectedRequest}
                />
              )}
              {tab === "account" && (
                <AccountPage
                  onCloudLoginSuccess={handleCloudLoginSuccess}
                  gatewayRunningAt={gatewayRunningAt}
                  onGoToSettings={() => setShowSettings(true)}
                  showToast={showToast}
                />
              )}
            </div>
          ))}
        </div>

        {/* Request detail overlay */}
        {selectedRequest && (
          <RequestDetail
            entry={selectedRequest}
            onClose={() => setSelectedRequest(null)}
          />
        )}

        {showSettings && (
          <Settings
            onClose={() => setShowSettings(false)}
          />
        )}

        {showOnboarding && (
          <Onboarding
            gatewayMode={getGatewayMode()}
            hasProviders={hasProviders}
            authToken={token}
            onDismiss={handleDismissOnboarding}
          />
        )}

        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </ErrorBoundary>
    </Panel>
  );
}
