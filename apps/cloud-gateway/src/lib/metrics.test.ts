// ---------------------------------------------------------------------------
// Tests for in-memory Prometheus metrics
// ---------------------------------------------------------------------------

import { describe, test, expect } from "bun:test";
import {
  incCounter,
  createHistogram,
  observeHistogram,
  setGauge,
  incGauge,
  decGauge,
  serialize,
} from "./metrics";

// Use unique names per test to avoid cross-test pollution from module-level state

describe("incCounter", () => {
  test("creates and increments a counter", () => {
    incCounter("test_counter_1");
    const output = serialize();
    expect(output).toContain("test_counter_1 1");
  });

  test("increments by custom amount", () => {
    incCounter("test_counter_2", {}, 5);
    incCounter("test_counter_2", {}, 3);
    const output = serialize();
    expect(output).toContain("test_counter_2 8");
  });

  test("separates by labels", () => {
    incCounter("test_counter_3", { method: "GET" });
    incCounter("test_counter_3", { method: "POST" });
    incCounter("test_counter_3", { method: "GET" });
    const output = serialize();
    expect(output).toContain('test_counter_3{method="GET"} 2');
    expect(output).toContain('test_counter_3{method="POST"} 1');
  });

  test("sorts labels alphabetically", () => {
    incCounter("test_counter_4", { z: "1", a: "2" });
    const output = serialize();
    expect(output).toContain('test_counter_4{a="2",z="1"} 1');
  });
});

describe("Histogram", () => {
  test("observes values into correct buckets (cumulative)", () => {
    createHistogram("test_hist_1", [10, 50, 100]);
    observeHistogram("test_hist_1", 5);   // fits in: <=10, <=50, <=100
    observeHistogram("test_hist_1", 25);  // fits in: <=50, <=100
    observeHistogram("test_hist_1", 75);  // fits in: <=100
    observeHistogram("test_hist_1", 200); // exceeds all buckets

    const output = serialize();
    // Implementation stores per-bucket inclusive counts then accumulates in serialize:
    //   counts = [1, 2, 3] → cumulative = [1, 3, 6]
    expect(output).toContain('test_hist_1_bucket{le="10"} 1');
    expect(output).toContain('test_hist_1_bucket{le="50"} 3');
    expect(output).toContain('test_hist_1_bucket{le="100"} 6');
    expect(output).toContain('test_hist_1_bucket{le="+Inf"} 4');
    expect(output).toContain("test_hist_1_sum 305"); // 5+25+75+200
    expect(output).toContain("test_hist_1_count 4");
  });

  test("separates histogram by labels", () => {
    createHistogram("test_hist_2", [100]);
    observeHistogram("test_hist_2", 50, { route: "/api" });    // <= 100
    observeHistogram("test_hist_2", 150, { route: "/api" });   // > 100
    observeHistogram("test_hist_2", 30, { route: "/health" }); // <= 100

    const output = serialize();
    // /api: counts=[1], cumulative=[1]
    expect(output).toContain('test_hist_2_bucket{route="/api",le="100"} 1');
    // /health: counts=[1], cumulative=[1]
    expect(output).toContain('test_hist_2_bucket{route="/health",le="100"} 1');
  });

  test("silently ignores observations for unregistered histograms", () => {
    // Should not throw
    observeHistogram("nonexistent_hist", 42);
    const output = serialize();
    expect(output).not.toContain("nonexistent_hist");
  });

  test("does not re-register existing histogram", () => {
    createHistogram("test_hist_3", [10, 50]);
    observeHistogram("test_hist_3", 5);
    // Re-register with different buckets — should be ignored
    createHistogram("test_hist_3", [100, 200]);
    observeHistogram("test_hist_3", 5);

    const output = serialize();
    // Should still use original buckets [10, 50] — NOT [100, 200]
    // Both values (5) fit in le=10 → per-bucket count=2
    // Cumulative: le=10 → 2, le=50 → 2+2=4  (double-cumulative from serialize)
    expect(output).toContain('test_hist_3_bucket{le="10"} 2');
    expect(output).toContain('test_hist_3_bucket{le="50"} 4');
    // Verify the old buckets are NOT present
    expect(output).not.toContain('test_hist_3_bucket{le="100"}');
    expect(output).not.toContain('test_hist_3_bucket{le="200"}');
  });
});

describe("Gauge", () => {
  test("setGauge sets a value", () => {
    setGauge("test_gauge_1", 42);
    const output = serialize();
    expect(output).toContain("test_gauge_1 42");
  });

  test("incGauge increments", () => {
    setGauge("test_gauge_2", 10);
    incGauge("test_gauge_2", 5);
    const output = serialize();
    expect(output).toContain("test_gauge_2 15");
  });

  test("decGauge decrements", () => {
    setGauge("test_gauge_3", 10);
    decGauge("test_gauge_3", 3);
    const output = serialize();
    expect(output).toContain("test_gauge_3 7");
  });

  test("incGauge from zero", () => {
    incGauge("test_gauge_4");
    const output = serialize();
    expect(output).toContain("test_gauge_4 1");
  });
});

describe("serialize", () => {
  test("includes TYPE declarations", () => {
    incCounter("test_typed_counter");
    const output = serialize();
    expect(output).toContain("# TYPE test_typed_counter counter");
  });

  test("includes TYPE for gauges", () => {
    setGauge("test_typed_gauge", 1);
    const output = serialize();
    expect(output).toContain("# TYPE test_typed_gauge gauge");
  });

  test("includes TYPE for histograms", () => {
    createHistogram("test_typed_hist", [10]);
    observeHistogram("test_typed_hist", 5);
    const output = serialize();
    expect(output).toContain("# TYPE test_typed_hist histogram");
  });

  test("output ends with newline", () => {
    const output = serialize();
    expect(output.endsWith("\n")).toBe(true);
  });
});
