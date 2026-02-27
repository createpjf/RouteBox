import { Settings } from "lucide-react";
import clsx from "clsx";

interface HeaderProps {
  connected: boolean;
  stale?: boolean;
  onOpenSettings: () => void;
}

export function Header({ connected, stale, onOpenSettings }: HeaderProps) {
  const showCached = !connected && stale;

  return (
    <div className="flex items-center justify-between h-11 px-4 border-b border-border shrink-0">
      <span className="text-[13px] font-semibold text-text-primary tracking-[-0.01em]">
        RouteBox
      </span>
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            "badge gap-1.5",
            connected
              ? "text-accent-green bg-accent-green/10"
              : showCached
                ? "text-accent-amber bg-accent-amber/10"
                : "text-accent-red bg-accent-red/10"
          )}
        >
          <span
            className={clsx(
              "h-1.5 w-1.5 rounded-full shrink-0",
              connected
                ? "bg-accent-green pulse"
                : showCached
                  ? "bg-accent-amber"
                  : "bg-accent-red"
            )}
          />
          {connected ? "Live" : showCached ? "Cached" : "Offline"}
        </span>
        <button
          onClick={onOpenSettings}
          className="flex items-center justify-center h-7 w-7 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-white/[0.05] transition-colors"
        >
          <Settings size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
