import { useState, useEffect, useCallback, useRef } from "react";
import { Panel } from "@/components/Panel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HeroSection } from "@/components/HeroSection";
import { DashboardPage } from "@/components/DashboardPage";
import { RoutingPage } from "@/components/RoutingPage";
import { RequestLogPage } from "@/components/RequestLogPage";
import { TabBar } from "@/components/TabBar";
import type { TabId } from "@/components/TabBar";
import { Settings } from "@/components/Settings";
import { Onboarding } from "@/components/Onboarding";
import { RequestDetail } from "@/components/RequestDetail";
import { AnalyticsPage } from "@/components/AnalyticsPage";
import { UsagePage } from "@/components/UsagePage";
import { AlertBanner } from "@/components/AlertBanner";
import { ToastContainer } from "@/components/ToastContainer";
import { useRealtimeStats } from "@/hooks/useRealtimeStats";
import { useToast } from "@/hooks/useToast";
import { getGatewayUrl, setGatewayUrl, setAuthToken, getPortFromUrl } from "@/lib/constants";
import { checkGatewayHealth, waitForGateway, isLocalGatewayUrl } from "@/lib/gateway-health";
import type { RealtimeStats, RequestLogEntry } from "@/types/stats";

type GatewayState = "idle" | "checking" | "starting" | "running" | "failed";

const EMPTY_STATS: RealtimeStats = {
  requests: 0, tokens: 0, cost: 0, saved: 0,
  requestsDelta: 0, tokensDelta: 0, costDelta: 0,
  sparkline: [], providers: [], balance: 0,
  budget: 0, monthSpend: 0,
};

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(true); // default true to prevent flash
  const [selectedRequest, setSelectedRequest] = useState<RequestLogEntry | null>(null);
  const [gatewayState, setGatewayState] = useState<GatewayState>("idle");
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [token, setToken] = useState("");
  const { stats, connected, stale, history, requestLog, alert, dismissAlert } = useRealtimeStats(tokenLoaded);
  const { toasts, showToast, dismissToast } = useToast();

  // Load persisted settings before any API calls
  useEffect(() => {
    import("@tauri-apps/plugin-store")
      .then(({ load }) => load("settings.json", { defaults: {} }))
      .then(async (store) => {
        const url = await store.get<string>("gatewayUrl");
        if (url) setGatewayUrl(url);

        const dismissed = await store.get<boolean>("onboardingDismissed");
        setOnboardingDismissed(!!dismissed);
      })
      .catch(() => {
        // Not in Tauri — check if we should show onboarding anyway
        setOnboardingDismissed(false);
      })
      .finally(() => {
        setSettingsLoaded(true);
      });

    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string>("get_token"))
      .then((t) => { if (t) { setAuthToken(t); setToken(t); } })
      .catch(() => {});
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
        const isLocal = isLocalGatewayUrl(url);
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
          // Remote gateway: just report not reachable
          if (!cancelled) setGatewayState("failed");
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

  // Auto-show onboarding for first-run users (wait for stats to arrive)
  useEffect(() => {
    if (!connected || !stats || onboardingDismissed || showSettings) return;
    const hasProviders = stats.providers.length > 0;
    if (!hasProviders) {
      setShowOnboarding(true);
    }
  }, [connected, stats, onboardingDismissed, showSettings]);

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
          onOpenSpotlight={() => {
            import("@tauri-apps/api/core").then(({ invoke }) => invoke("toggle_spotlight")).catch(() => {});
          }}
        />
        {alert && (
          <AlertBanner
            title={alert.title}
            message={alert.message}
            onDismiss={dismissAlert}
          />
        )}
        <div key={activeTab} className="flex flex-1 min-h-0 animate-page-in">
          {activeTab === "dashboard" && (
            <DashboardPage stats={currentStats} history={history} />
          )}
          {activeTab === "routing" && (
            <RoutingPage stats={currentStats} showToast={showToast} />
          )}
          {activeTab === "logs" && (
            <RequestLogPage
              entries={requestLog}
              onSelectEntry={setSelectedRequest}
            />
          )}
          {activeTab === "usage" && <UsagePage />}
          {activeTab === "analytics" && <AnalyticsPage />}
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
            onShowOnboarding={() => {
              setShowSettings(false);
              setShowOnboarding(true);
            }}
          />
        )}

        {showOnboarding && (
          <Onboarding
            connected={connected}
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
