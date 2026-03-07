import { LayoutDashboard, Route, ScrollText } from "lucide-react";
import clsx from "clsx";

export type TabId = "home" | "routing" | "activity";

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const TABS: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "home",     label: "Home",     icon: LayoutDashboard },
  { id: "routing",  label: "Routing",  icon: Route },
  { id: "activity", label: "Activity", icon: ScrollText },
];

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div
      className="flex items-center justify-around h-14 shrink-0"
      style={{
        background: "var(--color-bg-panel)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={clsx(
              "relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors",
              active
                ? "text-text-primary"
                : "text-text-tertiary hover:text-text-secondary"
            )}
          >
            {active && (
              <div
                className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-8 rounded-b-full"
                style={{ backgroundColor: "#ff4d00" }}
              />
            )}
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
