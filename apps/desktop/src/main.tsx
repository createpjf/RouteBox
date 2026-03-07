import React, { lazy, Suspense, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { setAuthToken } from "./lib/constants";
import "./styles/globals.css";

const SpotlightWindow = lazy(() =>
  import("./windows/SpotlightWindow").then((m) => ({ default: m.SpotlightWindow })),
);
const ChatWindow = lazy(() =>
  import("./windows/ChatWindow").then((m) => ({ default: m.ChatWindow })),
);

function Root() {
  const hash = window.location.hash;
  const [tokenReady, setTokenReady] = useState(false);

  // Load auth token for ALL windows (panel, spotlight, chat)
  useEffect(() => {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string>("get_token"))
      .then((t) => { if (t) setAuthToken(t); })
      .catch(() => {})
      .finally(() => setTokenReady(true));
  }, []);

  // Load saved theme preference
  useEffect(() => {
    import("@tauri-apps/plugin-store")
      .then(({ load }) => load("settings.json", { defaults: {}, autoSave: true }))
      .then(async (store) => {
        const t = await store.get<string>("theme");
        if (t === "light" || t === "dark") {
          document.documentElement.dataset.theme = t;
        }
      })
      .catch(() => {});
  }, []);

  // Main panel doesn't need to wait — App.tsx has its own token loading
  if (!hash || hash === "#/") {
    return <App />;
  }

  // Sub-windows wait for token before rendering
  if (!tokenReady) return null;

  if (hash === "#/spotlight") {
    return (
      <Suspense fallback={null}>
        <SpotlightWindow />
      </Suspense>
    );
  }

  if (hash === "#/chat") {
    return (
      <Suspense fallback={null}>
        <ChatWindow />
      </Suspense>
    );
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
