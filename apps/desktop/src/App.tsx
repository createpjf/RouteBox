import { useState, useEffect } from "react";
import { Panel } from "@/components/Panel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Dashboard } from "@/components/Dashboard";
import { Settings } from "@/components/Settings";
import { setGatewayUrl, setAuthToken } from "@/lib/constants";

export function App() {
  const [view, setView] = useState<"dashboard" | "settings">("dashboard");

  // Load persisted settings before any API calls
  useEffect(() => {
    // Load gateway URL from store
    import("@tauri-apps/plugin-store")
      .then(({ load }) => load("settings.json", { defaults: {} }))
      .then(async (store) => {
        const url = await store.get<string>("gatewayUrl");
        if (url) setGatewayUrl(url);
      })
      .catch(() => {});

    // Load token from Keychain
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string>("get_token"))
      .then((t) => { if (t) setAuthToken(t); })
      .catch(() => {});
  }, []);

  return (
    <Panel>
      <ErrorBoundary>
        {view === "dashboard" ? (
          <Dashboard onOpenSettings={() => setView("settings")} />
        ) : (
          <Settings onBack={() => setView("dashboard")} />
        )}
      </ErrorBoundary>
    </Panel>
  );
}
