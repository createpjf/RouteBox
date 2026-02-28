import { LayoutDashboard, Route, ScrollText, BarChart3 } from "lucide-react";
import clsx from "clsx";

export type TabId = "dashboard" | "routing" | "logs" | "analytics";

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const TABS: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "routing", label: "Routing", icon: Route },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div
      className="flex items-center justify-around h-14 shrink-0"
      style={{
        background: "rgba(242,242,247,0.92)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderTop: "0.5px solid rgba(0,0,0,0.08)",
      }}
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={clsx(
              "flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors",
              active
                ? "text-[#1D1D1F]"
                : "text-[#AEAEB2] hover:text-[#86868B]"
            )}
          >
            <Icon size={20} strokeWidth={1.4} />
            <span
              className="text-[9px]"
              style={{ fontWeight: active ? 600 : 500 }}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
