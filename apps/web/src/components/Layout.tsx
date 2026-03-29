import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Code,
  DollarSign,
  BarChart3,
  Key,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/api", icon: Code, label: "API" },
  { to: "/billing", icon: DollarSign, label: "Billing" },
  { to: "/usage", icon: BarChart3, label: "Usage" },
  { to: "/keys", icon: Key, label: "Keys" },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="min-h-screen bg-bg-page">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-bg-page/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-8">
          {/* Logo */}
          <NavLink to="/" className="flex items-center gap-2.5 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-accent-ember flex items-center justify-center">
              <span className="text-white font-bold text-xs">R</span>
            </div>
            <span className="font-bold text-base text-text-primary tracking-tight">RouteBox</span>
          </NavLink>

          {/* Nav Links */}
          <nav className="flex items-center gap-1">
            {navItems.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "text-accent-ember"
                      : "text-text-secondary hover:text-text-primary"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* User Menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border hover:border-border-light transition-colors text-sm"
            >
              <span className="text-text-primary">{user?.email || "User"}</span>
              <ChevronDown size={14} className="text-text-tertiary" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-bg-card border border-border rounded-xl shadow-lg overflow-hidden animate-fade-in">
                <div className="px-4 py-3 border-b border-border-light">
                  <div className="text-sm font-medium text-text-primary truncate">
                    {user?.displayName || user?.email}
                  </div>
                  <div className="text-xs text-text-tertiary capitalize mt-0.5">
                    {user?.plan || "starter"} plan
                  </div>
                </div>
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-text-secondary hover:text-accent-red hover:bg-bg-row-hover transition-colors"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
