import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/globals.css";

const SpotlightWindow = lazy(() =>
  import("./windows/SpotlightWindow").then((m) => ({ default: m.SpotlightWindow })),
);
const ChatWindow = lazy(() =>
  import("./windows/ChatWindow").then((m) => ({ default: m.ChatWindow })),
);

function Root() {
  const hash = window.location.hash;

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
