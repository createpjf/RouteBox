// ---------------------------------------------------------------------------
// In-memory Prometheus-compatible metrics — zero dependencies
// ---------------------------------------------------------------------------

// ── Counters ────────────────────────────────────────────────────────────────

const counters = new Map<string, Map<string, number>>();

export function incCounter(
  name: string,
  labels: Record<string, string> = {},
  amount = 1,
): void {
  if (!counters.has(name)) counters.set(name, new Map());
  const store = counters.get(name)!;
  const key = labelKey(labels);
  store.set(key, (store.get(key) ?? 0) + amount);
}

// ── Histograms ──────────────────────────────────────────────────────────────

interface HistogramData {
  buckets: number[];
  counts: Map<string, number[]>;
  sums: Map<string, number>;
  totals: Map<string, number>;
}

const histograms = new Map<string, HistogramData>();

export function createHistogram(name: string, buckets: number[]): void {
  if (histograms.has(name)) return;
  histograms.set(name, {
    buckets: [...buckets].sort((a, b) => a - b),
    counts: new Map(),
    sums: new Map(),
    totals: new Map(),
  });
}

export function observeHistogram(
  name: string,
  value: number,
  labels: Record<string, string> = {},
): void {
  const h = histograms.get(name);
  if (!h) return;
  const key = labelKey(labels);
  if (!h.counts.has(key)) {
    h.counts.set(key, new Array(h.buckets.length).fill(0) as number[]);
    h.sums.set(key, 0);
    h.totals.set(key, 0);
  }
  const counts = h.counts.get(key)!;
  for (let i = 0; i < h.buckets.length; i++) {
    if (value <= h.buckets[i]!) counts[i]!++;
  }
  h.sums.set(key, h.sums.get(key)! + value);
  h.totals.set(key, h.totals.get(key)! + 1);
}

// ── Gauges ───────────────────────────────────────────────────────────────────

const gauges = new Map<string, number>();

export function setGauge(name: string, value: number): void {
  gauges.set(name, value);
}

export function incGauge(name: string, amount = 1): void {
  gauges.set(name, (gauges.get(name) ?? 0) + amount);
}

export function decGauge(name: string, amount = 1): void {
  gauges.set(name, (gauges.get(name) ?? 0) - amount);
}

// ── Serialization (Prometheus text exposition format) ────────────────────────

function labelKey(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}="${v}"`).join(",");
}

function labelStr(key: string): string {
  return key ? `{${key}}` : "";
}

export function serialize(): string {
  const lines: string[] = [];

  // Counters
  for (const [name, store] of counters) {
    lines.push(`# TYPE ${name} counter`);
    for (const [key, val] of store) {
      lines.push(`${name}${labelStr(key)} ${val}`);
    }
  }

  // Histograms
  for (const [name, h] of histograms) {
    lines.push(`# TYPE ${name} histogram`);
    for (const [key, counts] of h.counts) {
      let cumulative = 0;
      for (let i = 0; i < h.buckets.length; i++) {
        cumulative += counts[i]!;
        const lbl = key
          ? `${key},le="${h.buckets[i]}"`
          : `le="${h.buckets[i]}"`;
        lines.push(`${name}_bucket{${lbl}} ${cumulative}`);
      }
      const infLbl = key ? `${key},le="+Inf"` : `le="+Inf"`;
      lines.push(`${name}_bucket{${infLbl}} ${h.totals.get(key) ?? 0}`);
      lines.push(`${name}_sum${labelStr(key)} ${h.sums.get(key) ?? 0}`);
      lines.push(`${name}_count${labelStr(key)} ${h.totals.get(key) ?? 0}`);
    }
  }

  // Gauges
  for (const [name, val] of gauges) {
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${val}`);
  }

  return lines.join("\n") + "\n";
}

// ── Pre-register standard histograms ────────────────────────────────────────

createHistogram("http_request_duration_ms", [
  50, 100, 250, 500, 1000, 2500, 5000, 10000,
]);
createHistogram("provider_request_duration_ms", [
  100, 250, 500, 1000, 2500, 5000, 10000, 30000,
]);
