import { BarChart3, Power } from "lucide-react";

export function Footer() {
  const handleDashboard = () => {
    window.open("https://app.routebox.dev/dashboard", "_blank");
  };

  const handleQuit = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      // Browser fallback
    }
  };

  return (
    <div className="border-t border-border h-11 px-4 flex items-center justify-around shrink-0">
      <button
        onClick={handleDashboard}
        className="flex items-center gap-1.5 text-[11px] font-medium text-text-tertiary hover:text-text-primary px-3 py-1 rounded-lg hover:bg-white/[0.04] transition-colors"
      >
        <BarChart3 size={14} strokeWidth={1.75} />
        Dashboard
      </button>
      <div className="w-px h-3 bg-border" />
      <button
        onClick={handleQuit}
        className="flex items-center gap-1.5 text-[11px] font-medium text-text-tertiary hover:text-accent-red px-3 py-1 rounded-lg hover:bg-white/[0.04] transition-colors"
      >
        <Power size={14} strokeWidth={1.75} />
        Quit
      </button>
    </div>
  );
}
