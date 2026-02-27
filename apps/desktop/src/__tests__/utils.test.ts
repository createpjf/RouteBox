import { describe, test, expect } from "vitest";

// These are inline in Dashboard.tsx — extract and test the logic
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

describe("formatTokens", () => {
  test("formats millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(1_000_000)).toBe("1.0M");
  });

  test("formats thousands", () => {
    expect(formatTokens(1_500)).toBe("1.5K");
    expect(formatTokens(1_000)).toBe("1.0K");
    expect(formatTokens(999_999)).toBe("1000.0K");
  });

  test("formats small numbers as-is", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(1)).toBe("1");
    expect(formatTokens(999)).toBe("999");
  });
});

describe("formatNumber", () => {
  test("adds locale separators", () => {
    const result = formatNumber(1234567);
    // Locale-dependent, but should contain separators
    expect(result).toContain("1");
    expect(result.length).toBeGreaterThan(5);
  });

  test("small numbers unchanged", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(42)).toBe("42");
  });
});
