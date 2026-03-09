import { Settings, Loader2, MessageSquare, BookOpen, AlertTriangle } from "lucide-react";
import { getGatewayMode } from "@/lib/constants";

type GatewayState = "idle" | "checking" | "starting" | "running" | "failed";

interface HeroSectionProps {
  connected: boolean;
  stale?: boolean;
  gatewayState?: GatewayState;
  gatewayError?: string | null;
  balanceCents?: number;
  onOpenSettings: () => void;
  onOpenChat?: () => void;
  onShowOnboarding?: () => void;
  onGoToAccount?: () => void;
}

export function HeroSection({ connected, stale, gatewayState, gatewayError, balanceCents, onOpenSettings, onOpenChat, onShowOnboarding, onGoToAccount }: HeroSectionProps) {
  const mode = getGatewayMode();
  const effectivelyOnline = connected || (mode === "cloud" && gatewayState === "running");

  let statusText = effectivelyOnline ? "Online" : "Offline";
  let statusColor = effectivelyOnline ? "#34C759" : "var(--color-dot-offline)";
  let showSpinner = false;

  if (gatewayState === "idle") {
    statusText = "Not signed in";
    statusColor = "var(--color-dot-offline)";
  } else if (gatewayState === "checking" || gatewayState === "starting") {
    statusText = gatewayState === "checking" ? "Checking…" : "Starting gateway…";
    statusColor = "#FF9500";
    showSpinner = true;
  } else if (gatewayState === "failed") {
    statusText = "Gateway failed";
    statusColor = "#FF3B30";
  } else if (!connected && stale) {
    statusText = "Reconnecting…";
    statusColor = "#FF9500";
    showSpinner = true;
  }

  const shortError = gatewayError
    ?.replace(/^Failed to spawn gateway:\s*/, "")
    .replace(/Cannot read properties of undefined.*/, "Tauri runtime unavailable")
    .slice(0, 80);

  return (
    <div
      className="shrink-0"
      style={{
        background: "var(--color-bg-panel)",
      }}
      data-tauri-drag-region
    >
      <div className="flex items-center justify-between px-5 pt-4 pb-2.5">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[17px] font-bold text-text-primary tracking-[-0.02em] leading-none">
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
          {onShowOnboarding && (
            <button
              onClick={onShowOnboarding}
              className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-hover-overlay transition-colors"
              title="Setup Guide"
            >
              <BookOpen size={15} strokeWidth={1.6} className="text-text-tertiary" />
            </button>
          )}
          {onOpenChat && (
            <button
              onClick={onOpenChat}
              className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-hover-overlay transition-colors"
              title="Chat"
            >
              <MessageSquare size={15} strokeWidth={1.6} className="text-text-tertiary" />
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-hover-overlay transition-colors"
          >
            <Settings size={16} strokeWidth={1.6} className="text-text-tertiary" />
          </button>
        </div>
      </div>
      {gatewayState === "failed" && shortError && (
        <div className="px-5 pb-2 -mt-1">
          <p className="text-[10px] text-[#FF3B30] leading-tight truncate">{shortError}</p>
        </div>
      )}
      {/* Low balance warning (P8) */}
      {mode === "cloud" && balanceCents !== undefined && balanceCents < 100 && balanceCents >= 0 && (
        <button
          onClick={onGoToAccount}
          className="mx-5 mb-2 px-3 py-1.5 rounded-lg flex items-center gap-2 text-left transition-colors hover:bg-[#FF9500]/15"
          style={{ background: "rgba(255, 149, 0, 0.08)", border: "1px solid rgba(255, 149, 0, 0.15)" }}
        >
          <AlertTriangle size={12} strokeWidth={2} className="text-[#FF9500] shrink-0" />
          <span className="text-[10px] text-[#FF9500] font-medium">
            Low balance (${(balanceCents / 100).toFixed(2)}) — tap to add credits
          </span>
        </button>
      )}
    </div>
  );
}
