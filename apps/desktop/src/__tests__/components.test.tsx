import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// Mock lucide-react — vi.mock is hoisted above imports, so use inline require
vi.mock("lucide-react", async () => {
  const React = await import("react");
  const icon = (props: any) => React.createElement("span", { "data-testid": "icon", ...props });
  return { Settings: icon, AlertTriangle: icon, RotateCcw: icon, X: icon };
});

// Mock constants to avoid Tauri imports
vi.mock("@/lib/constants", () => ({
  PROVIDER_COLORS: {
    OpenAI: "#10A37F",
    Anthropic: "#D4A574",
    Google: "#4285F4",
  } as Record<string, string>,
  ROUTING_STRATEGIES: [],
  getGatewayUrl: () => "http://localhost:3001",
  getWsUrl: () => "ws://localhost:3001/ws/stats",
  setGatewayUrl: () => {},
  getAuthToken: () => "",
  setAuthToken: () => {},
  WS_RECONNECT_MAX_DELAY: 30000,
  WS_PING_INTERVAL: 25000,
}));

import { Header } from "../components/Header";
import { ProviderStatus } from "../components/ProviderStatus";
import { RequestLog } from "../components/RequestLog";
import { ToastContainer } from "../components/ToastContainer";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { StatCard } from "../components/StatCard";

describe("Header", () => {
  test("shows 'Live' when connected", () => {
    render(<Header connected={true} onOpenSettings={() => {}} />);
    expect(screen.getByText("Live")).toBeDefined();
  });

  test("shows 'Offline' when disconnected", () => {
    render(<Header connected={false} onOpenSettings={() => {}} />);
    expect(screen.getByText("Offline")).toBeDefined();
  });

  test("shows 'Cached' when disconnected + stale", () => {
    render(<Header connected={false} stale={true} onOpenSettings={() => {}} />);
    expect(screen.getByText("Cached")).toBeDefined();
  });

  test("calls onOpenSettings when settings button clicked", () => {
    const onOpen = vi.fn();
    render(<Header connected={true} onOpenSettings={onOpen} />);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("StatCard", () => {
  test("renders label and value", () => {
    render(
      <StatCard label="Requests" value="1,234" icon={<span>i</span>} color="#3B82F6" />
    );
    expect(screen.getByText("Requests")).toBeDefined();
    expect(screen.getByText("1,234")).toBeDefined();
  });

  test("renders positive delta with + prefix", () => {
    render(
      <StatCard label="Tokens" value="5K" icon={<span>i</span>} color="#FFF" delta={12} />
    );
    expect(screen.getByText("+12%")).toBeDefined();
  });

  test("renders negative delta without + prefix", () => {
    render(
      <StatCard label="Cost" value="$5" icon={<span>i</span>} color="#FFF" delta={-8} />
    );
    expect(screen.getByText("-8%")).toBeDefined();
  });

  test("hides delta when zero", () => {
    const { container } = render(
      <StatCard label="Tokens" value="5K" icon={<span>i</span>} color="#FFF" delta={0} />
    );
    expect(container.textContent).not.toContain("0%");
  });

  test("renders subtitle", () => {
    render(
      <StatCard label="Saved" value="$1.50" icon={<span>i</span>} color="#FFF" subtitle="by routing" />
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
    expect(screen.getByText("timeout")).toBeDefined();
  });
});

describe("RequestLog", () => {
  test("renders empty state", () => {
    render(<RequestLog entries={[]} />);
    expect(screen.getByText("Waiting for requests...")).toBeDefined();
  });

  test("renders entries with status badges", () => {
    render(
      <RequestLog
        entries={[
          { id: "1", timestamp: Date.now(), provider: "OpenAI", model: "gpt-4o", tokens: 100, cost: 0.001, latencyMs: 120, status: "success" },
          { id: "2", timestamp: Date.now(), provider: "Anthropic", model: "claude-sonnet-4-20250514", tokens: 200, cost: 0.003, latencyMs: 350, status: "error" },
        ]}
      />
    );
    expect(screen.getByText("gpt-4o")).toBeDefined();
    expect(screen.getByText("OK")).toBeDefined();
    expect(screen.getByText("ERR")).toBeDefined();
    expect(screen.getByText("2 recent")).toBeDefined();
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
    // After reset, it will try to render MaybeThrow again
    // Since shouldThrow is now false, it should show "Recovered"
    rerender(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText("Recovered")).toBeDefined();
    spy.mockRestore();
  });
});
