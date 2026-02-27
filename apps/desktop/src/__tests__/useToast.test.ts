import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useToast } from "../hooks/useToast";

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("starts with empty toasts", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
  });

  test("showToast adds a toast", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("Something failed");
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Something failed");
    expect(result.current.toasts[0].type).toBe("error");
  });

  test("showToast with success type", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("Done!", "success");
    });
    expect(result.current.toasts[0].type).toBe("success");
  });

  test("toast auto-dismisses after 3 seconds", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("Temporary");
    });
    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  test("dismissToast removes specific toast", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("First");
      result.current.showToast("Second");
    });
    expect(result.current.toasts).toHaveLength(2);

    const idToRemove = result.current.toasts[0].id;
    act(() => {
      result.current.dismissToast(idToRemove);
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Second");
  });

  test("limits to 3 toasts max", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("One");
      result.current.showToast("Two");
      result.current.showToast("Three");
      result.current.showToast("Four");
    });
    // slice(-2) + new = 3 max kept
    expect(result.current.toasts.length).toBeLessThanOrEqual(3);
    // Latest toast should be present
    expect(result.current.toasts[result.current.toasts.length - 1].message).toBe("Four");
  });
});
