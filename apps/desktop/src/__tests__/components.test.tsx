import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock lucide-react — vi.mock is hoisted above imports, so use inline require
vi.mock("lucide-react", async () => {
  const React = await import("react");
  const icon = (props: any) => React.createElement("span", { "data-testid": "icon", ...props });
  return {
    Settings: icon, AlertTriangle: icon, RotateCcw: icon, X: icon,
    ChevronRight: icon, Wifi: icon, Box: icon, Copy: icon, Check: icon,
    Pause: icon, Play: icon, Coins: icon, DollarSign: icon, Sparkles: icon,
    Zap: icon, Loader2: icon, Trash2: icon, ChevronDown: icon,
    LayoutDashboard: icon, Route: icon, ScrollText: icon, Search: icon,
    Wallet: icon, Activity: icon, XCircle: icon,
    Key: icon, Shield: icon, AlertCircle: icon, BookOpen: icon, ArrowRight: icon,
    BarChart3: icon, Pin: icon, Ban: icon, Plus: icon, Square: icon,
    TrendingUp: icon, Cpu: icon, Clock: icon, PieChart: icon, UserCircle: icon,
  };
});

// Mock constants to avoid Tauri imports
vi.mock("@/lib/constants", () => ({
  PROVIDER_COLORS: {
    OpenAI: "#10A37F",
    Anthropic: "#D4A574",
    Google: "#4285F4",
    DeepSeek: "#4D6BFE",
    MiniMax: "#E85B2B",
    Kimi: "#5856D6",
    Flock: "#7C3AED",
  } as Record<string, string>,
  ROUTING_STRATEGIES: [],
  getGatewayUrl: () => "http://localhost:3001",
  getWsUrl: () => "ws://localhost:3001/ws/stats",
  setGatewayUrl: () => {},
  getGatewayMode: () => "local",
  setGatewayMode: () => {},
  getAuthToken: () => "",
  setAuthToken: () => {},
  getCloudAuthToken: () => "",
  setCloudAuthToken: () => {},
  getPortFromUrl: () => 3001,
  isLocalGatewayUrl: () => true,
  isRouteboxCloud: () => false,
  ROUTEBOX_CLOUD_URL: "https://api.routebox.dev",
  WS_RECONNECT_MAX_DELAY: 30000,
  WS_PING_INTERVAL: 25000,
}));

import { HeroSection } from "../components/HeroSection";
import { ProviderStatus } from "../components/ProviderStatus";
import { ToastContainer } from "../components/ToastContainer";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { StatCard } from "../components/StatCard";
import { TabBar } from "../components/TabBar";

// Simple mock icon for StatCard tests
const MockIcon = (props: any) => <span data-testid="stat-icon" {...props} />;

describe("HeroSection", () => {
  const noop = () => {};

  test("shows 'Online' when connected", () => {
    render(<HeroSection connected={true} onOpenSettings={noop} />);
    expect(screen.getByText("Online")).toBeDefined();
  });

  test("shows 'Offline' when disconnected", () => {
    render(<HeroSection connected={false} onOpenSettings={noop} />);
    expect(screen.getByText("Offline")).toBeDefined();
  });

  test("renders RouteBox title", () => {
    render(<HeroSection connected={true} onOpenSettings={noop} />);
    expect(screen.getByText("RouteBox")).toBeDefined();
  });
});

describe("StatCard", () => {
  test("renders label and value", () => {
    render(
      <StatCard label="Requests" value="1,234" color="#3B82F6" icon={MockIcon} />
    );
    expect(screen.getByText("Requests")).toBeDefined();
    expect(screen.getByText("1,234")).toBeDefined();
  });

  test("renders icon", () => {
    render(
      <StatCard label="Requests" value="1,234" color="#3B82F6" icon={MockIcon} />
    );
    expect(screen.getByTestId("stat-icon")).toBeDefined();
  });

  test("renders positive delta with + prefix", () => {
    render(
      <StatCard label="Tokens" value="5K" color="#FFF" icon={MockIcon} delta={12} />
    );
    expect(screen.getByText("+12%")).toBeDefined();
  });

  test("renders negative delta without + prefix", () => {
    render(
      <StatCard label="Cost" value="$5" color="#FFF" icon={MockIcon} delta={-8} />
    );
    expect(screen.getByText("-8%")).toBeDefined();
  });

  test("hides delta when zero", () => {
    const { container } = render(
      <StatCard label="Tokens" value="5K" color="#FFF" icon={MockIcon} delta={0} />
    );
    expect(container.textContent).not.toContain("0%");
  });

  test("renders subtitle", () => {
    render(
      <StatCard label="Saved" value="$1.50" color="#FFF" icon={MockIcon} subtitle="by routing" />
    );
    expect(screen.getByText("by routing")).toBeDefined();
  });
});

describe("ProviderStatus", () => {
  test("renders empty state when no providers", () => {
    render(<ProviderStatus providers={[]} />);
    expect(screen.getByText("No providers configured")).toBeDefined();
  });

  test("renders provider list with latency", () => {
    render(
      <ProviderStatus
        providers={[
          { name: "OpenAI", latency: 120, isUp: true, keySource: "byok", requestsToday: 5 },
          { name: "Anthropic", latency: 200, isUp: false, keySource: "byok", requestsToday: 0 },
        ]}
      />
    );
    expect(screen.getByText("OpenAI")).toBeDefined();
    expect(screen.getByText("Anthropic")).toBeDefined();
    expect(screen.getByText("120ms")).toBeDefined();
    expect(screen.getByText("offline")).toBeDefined();
  });
});

describe("TabBar", () => {
  test("renders three tabs", () => {
    render(<TabBar activeTab="home" onTabChange={() => {}} />);
    expect(screen.getByText("Home")).toBeDefined();
    expect(screen.getByText("Routing")).toBeDefined();
    expect(screen.getByText("Activity")).toBeDefined();
  });

  test("calls onTabChange when tab clicked", () => {
    const onTabChange = vi.fn();
    render(<TabBar activeTab="home" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByText("Routing"));
    expect(onTabChange).toHaveBeenCalledWith("routing");
  });
});

describe("ToastContainer", () => {
  test("renders nothing when empty", () => {
    const { container } = render(<ToastContainer toasts={[]} onDismiss={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  test("renders toast messages", () => {
    render(
      <ToastContainer
        toasts={[
          { id: "t1", message: "Something failed", type: "error" },
          { id: "t2", message: "Done!", type: "success" },
        ]}
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText("Something failed")).toBeDefined();
    expect(screen.getByText("Done!")).toBeDefined();
  });

  test("dismiss button calls onDismiss with toast id", () => {
    const onDismiss = vi.fn();
    render(
      <ToastContainer
        toasts={[{ id: "t1", message: "Error", type: "error" }]}
        onDismiss={onDismiss}
      />
    );
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });
});

describe("ErrorBoundary", () => {
  test("renders children normally", () => {
    render(
      <ErrorBoundary>
        <div>Child content</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("Child content")).toBeDefined();
  });

  test("catches errors and shows fallback", () => {
    const ThrowingComponent = () => {
      throw new Error("Test error");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(screen.getByText("Test error")).toBeDefined();
    spy.mockRestore();
  });

  test("reload button resets error state", () => {
    let shouldThrow = true;
    const MaybeThrow = () => {
      if (shouldThrow) throw new Error("Boom");
      return <div>Recovered</div>;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeDefined();
    shouldThrow = false;
    fireEvent.click(screen.getByText("Reload"));
    rerender(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText("Recovered")).toBeDefined();
    spy.mockRestore();
  });
});
