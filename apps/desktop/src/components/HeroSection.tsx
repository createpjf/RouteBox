import { Settings, Loader2, MessageSquare, Sparkles } from "lucide-react";

type GatewayState = "idle" | "checking" | "starting" | "running" | "failed";

interface HeroSectionProps {
  connected: boolean;
  stale?: boolean;
  gatewayState?: GatewayState;
  gatewayError?: string | null;
  onOpenSettings: () => void;
  onOpenChat?: () => void;
  onOpenSpotlight?: () => void;
}

export function HeroSection({ connected, stale, gatewayState, gatewayError, onOpenSettings, onOpenChat, onOpenSpotlight }: HeroSectionProps) {
  // Derive status text & color
  let statusText = connected ? "Online" : "Offline";
  let statusColor = connected ? "#34C759" : "#C7C7CC";
  let showSpinner = false;

  if (gatewayState === "checking" || gatewayState === "starting") {
    statusText = gatewayState === "checking" ? "Checking…" : "Starting gateway…";
    statusColor = "#FF9500"; // amber
    showSpinner = true;
  } else if (gatewayState === "failed") {
    statusText = "Gateway failed";
    statusColor = "#FF3B30"; // red
  } else if (connected && stale) {
    statusText = "Reconnecting…";
    statusColor = "#FF9500"; // amber
    showSpinner = true;
  }

  // Shorten common Tauri/Rust error messages for display
  const shortError = gatewayError
    ?.replace(/^Failed to spawn gateway:\s*/, "")
    .replace(/Cannot read properties of undefined.*/, "Tauri runtime unavailable")
    .slice(0, 80);

  return (
    <div
      className="shrink-0"
      style={{
        background: "rgba(242,242,247,0.92)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
      data-tauri-drag-region
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-2.5">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[17px] font-bold text-[#1D1D1F] tracking-[-0.02em] leading-none">
            RouteBox
          </h1>
          <div className="flex items-center gap-1.5">
            {showSpinner ? (
              <Loader2 size={10} strokeWidth={2.5} className="animate-spin shrink-0" style={{ color: statusColor }} />
            ) : (
              <div
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: statusColor }}
              />
            )}
            <span
              className="text-[11px] font-semibold"
              style={{ color: statusColor }}
            >
              {statusText}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onOpenSpotlight && (
            <button
              onClick={onOpenSpotlight}
              className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[#E8E8ED] transition-colors"
              title="Spotlight (⌘⇧X)"
            >
              <Sparkles size={15} strokeWidth={1.6} className="text-[#AEAEB2]" />
            </button>
          )}
          {onOpenChat && (
            <button
              onClick={onOpenChat}
              className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[#E8E8ED] transition-colors"
              title="Chat"
            >
              <MessageSquare size={15} strokeWidth={1.6} className="text-[#AEAEB2]" />
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[#E8E8ED] transition-colors"
          >
            <Settings size={16} strokeWidth={1.6} className="text-[#AEAEB2]" />
          </button>
        </div>
      </div>
      {gatewayState === "failed" && shortError && (
        <div className="px-5 pb-2 -mt-1">
          <p className="text-[10px] text-[#FF3B30] leading-tight truncate">{shortError}</p>
        </div>
      )}
    </div>
  );
}
