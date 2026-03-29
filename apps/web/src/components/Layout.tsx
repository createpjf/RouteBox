import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart3,
  CreditCard,
  User,
  Code,
  Store,
  LogOut,
  Share2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/usage", icon: BarChart3, label: "Usage" },
  { to: "/billing", icon: CreditCard, label: "Billing" },
  { to: "/account", icon: User, label: "Account" },
  { to: "/api-docs", icon: Code, label: "API Docs" },
  { to: "/marketplace", icon: Store, label: "Marketplace" },
  { to: "/my-listings", icon: Share2, label: "My Listings" },
];

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-[240px] shrink-0 bg-bg-sidebar border-r border-border flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center px-5 gap-3 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-accent-ember flex items-center justify-center">
            <span className="text-white font-bold text-sm">R</span>
          </div>
          <span className="font-bold text-lg text-text-primary tracking-tight">RouteBox</span>
          <span className="badge bg-accent-ember/20 text-accent-ember ml-auto">Cloud</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-accent-ember/10 text-accent-ember"
                    : "text-text-secondary hover:text-text-primary hover:bg-hover-overlay"
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-bg-elevated border border-border flex items-center justify-center">
              <span className="text-xs font-semibold text-text-secondary">
                {user?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "?"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-primary truncate">
                {user?.displayName || user?.email || "User"}
              </div>
              <div className="text-xs text-text-tertiary capitalize">{user?.plan || "starter"}</div>
            </div>
            <button
              onClick={logout}
              className="text-text-tertiary hover:text-accent-red transition-colors"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
