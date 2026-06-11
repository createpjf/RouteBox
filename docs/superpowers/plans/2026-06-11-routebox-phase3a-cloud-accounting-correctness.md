# RouteBox Phase 3a — Cloud Accounting Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the cloud gateway accounting bugs where routed/fallback requests are billed and recorded against the requested model instead of the actually served model, quota increments are not rolled back on upstream 4xx, and Prometheus model labels can grow without bound or emit unsafe values.

**Architecture:** Keep the changes local to cloud gateway request accounting. The proxy route will track `activeModel` beside `activeProvider`, compute pricing after routing succeeds, and use a bounded metric model label helper for all provider/token metric labels. Quota rollback stays in the proxy control flow because `checkDailyQuota` performs the increment before any upstream call.

**Tech Stack:** TypeScript + Bun (`bun test`), Hono route tests using existing module mocks, PostgreSQL mocked by `src/test-setup.ts`.

---

## Scope

**Included in Phase 3a:**
- **M1:** Account, bill, and expose metadata for the actual served model when scoring/fallback rewrites `body.model`.
- **L5:** Roll back the daily quota increment when the provider returns a non-retryable upstream 4xx before a request is served.
- **M5:** Bound cloud metrics `model` labels to known routed model IDs or `"other"`, and escape Prometheus label values.

**Deferred to later Phase 3 slices:**
- **M6:** Payment/bonus idempotency database constraints and migrations.
- **M2:** Transaction-scoped advisory migration lock.
- **M7-code:** Gateway `getStats()` delta baseline behavior.

## File Structure

| File | Responsibility | Operation |
|------|----------------|-----------|
| `apps/cloud-gateway/src/routes/proxy.ts` | Cloud routing, pricing, quota rollback, metric labels | Modify |
| `apps/cloud-gateway/src/routes/proxy-e2e.test.ts` | End-to-end route accounting and quota rollback tests | Modify |
| `apps/cloud-gateway/src/routes/proxy.test.ts` | Pure helper tests for bounded metric labels | Modify |
| `apps/cloud-gateway/src/lib/metrics.ts` | Prometheus label escaping | Modify |
| `apps/cloud-gateway/src/lib/metrics.test.ts` | Label escaping regression test | Modify |

**Execution notes:**
- Run cloud tests from `apps/cloud-gateway`.
- `src/routes/proxy-e2e.test.ts` already owns module mocks for scoring, metrics, model registry, quota, credits, key pool, and fetch; extend those mocks instead of adding a second test fixture.
- `src/test-setup.ts` preloads `db-cloud` and `credits` mocks. Do not bypass it.
- Clean AppleDouble files before commits: `find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null`.

---

## Task 1: M5 — Escape Prometheus Label Values

**Files:**
- Modify: `apps/cloud-gateway/src/lib/metrics.ts`
- Modify: `apps/cloud-gateway/src/lib/metrics.test.ts`

- [ ] **Step 1: Write the failing label escaping test**

Add this test inside the existing `describe("incCounter", ...)` block in `apps/cloud-gateway/src/lib/metrics.test.ts`:

```ts
  test("escapes label values for Prometheus text format", () => {
    incCounter("test_counter_escaped", { model: 'bad"slash\\line\nnext' });
    const output = serialize();
    expect(output).toContain('test_counter_escaped{model="bad\\"slash\\\\line\\nnext"} 1');
  });
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/metrics.test.ts -t "escapes label values"
```

Expected: FAIL because `labelKey()` currently interpolates raw label values.

- [ ] **Step 3: Implement label escaping**

In `apps/cloud-gateway/src/lib/metrics.ts`, replace `labelKey()` with:

```ts
function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function labelKey(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(",");
}
```

- [ ] **Step 4: Run metrics tests and verify GREEN**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/metrics.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/ROG_500GB/RouteBox
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/cloud-gateway/src/lib/metrics.ts apps/cloud-gateway/src/lib/metrics.test.ts
git commit -m "fix(cloud): escape Prometheus label values"
```

---

## Task 2: M5 — Bound Proxy Metric Model Labels

**Files:**
- Modify: `apps/cloud-gateway/src/routes/proxy.ts`
- Modify: `apps/cloud-gateway/src/routes/proxy.test.ts`
- Modify: `apps/cloud-gateway/src/routes/proxy-e2e.test.ts`

- [ ] **Step 1: Write pure helper tests**

In `apps/cloud-gateway/src/routes/proxy.test.ts`, add `metricModelLabel` to the import list:

```ts
  metricModelLabel,
```

Then add this block after the `resolveAlias` tests:

```ts
// ── metricModelLabel ───────────────────────────────────────────────────────

describe("metricModelLabel", () => {
  test("returns known served model IDs unchanged", () => {
    expect(metricModelLabel("kimi-k2.5", new Set(["kimi-k2.5", "minimax-m2.5"]))).toBe("kimi-k2.5");
  });

  test("collapses unknown model IDs to other", () => {
    expect(metricModelLabel("minimax-m2.5-user-supplied-variant", new Set(["kimi-k2.5"]))).toBe("other");
  });
});
```

- [ ] **Step 2: Run the helper tests and verify RED**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/routes/proxy.test.ts -t "metricModelLabel"
```

Expected: FAIL because `metricModelLabel` is not exported.

- [ ] **Step 3: Make e2e metrics mock observable**

In `apps/cloud-gateway/src/routes/proxy-e2e.test.ts`, add a metric call collector near the existing `deductCalls` and `recordCalls` declarations:

```ts
let metricCounterCalls: unknown[][] = [];
```

Change the `../lib/metrics` mock to record `incCounter` calls:

```ts
mock.module("../lib/metrics", () => ({
  incCounter: (...args: unknown[]) => {
    metricCounterCalls.push(args);
  },
  observeHistogram: () => {},
  incGauge: () => {},
  decGauge: () => {},
}));
```

In `beforeEach()`, reset it:

```ts
  metricCounterCalls = [];
```

- [ ] **Step 4: Write the e2e bounded label regression**

Add this test after the existing non-streaming T4 success test in `apps/cloud-gateway/src/routes/proxy-e2e.test.ts`:

```ts
  test("provider metrics use bounded model label for unregistered model IDs", async () => {
    const app = createApp({ userPlan: "pro" });

    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [], // disabled model check
    ];

    mockFetch(async () =>
      new Response(JSON.stringify(PROVIDER_JSON_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    const res = await app.request("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "minimax-user-supplied-variant",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    expect(res.status).toBe(200);
    const providerRequestMetric = metricCounterCalls.find(
      ([name, labels]) => name === "provider_requests_total" && (labels as any).status === "200",
    );
    expect(providerRequestMetric).toBeTruthy();
    expect((providerRequestMetric![1] as any).model).toBe("other");
  });
```

- [ ] **Step 5: Run the e2e bounded label test and verify RED**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/routes/proxy-e2e.test.ts -t "bounded model label"
```

Expected: FAIL because `provider_requests_total` currently uses raw `requestedModel`.

- [ ] **Step 6: Implement metric label helpers**

In `apps/cloud-gateway/src/routes/proxy.ts`, add this exported helper near the pricing helpers:

```ts
export function metricModelLabel(model: string, knownModelIds: Iterable<string>): string {
  const known = new Set(knownModelIds);
  return known.has(model) ? model : "other";
}
```

Inside the `/chat/completions` handler, after `let totalAttempts = 0;`, add:

```ts
  const knownMetricModels = new Set<string>();
  if (!isAutoRoute) {
    const entry = await getRegistryEntry(requestedModel);
    if (entry?.modelId) knownMetricModels.add(entry.modelId);
  }
  for (const candidate of scoredCandidates) {
    knownMetricModels.add(candidate.modelId);
  }
```

Before each provider attempt, compute the model actually sent to that provider:

```ts
    const servedModel = scored._scoredModelId ?? requestedModel;
    const metricModel = metricModelLabel(servedModel, knownMetricModels);
```

Then replace each `model: requestedModel` in provider request/token metric labels in `apps/cloud-gateway/src/routes/proxy.ts` with `model: metricModel` when it is inside the provider attempt loop, and with `model: activeMetricModel` after success. Task 3 introduces `activeMetricModel`; for this task, add:

```ts
  let activeMetricModel = metricModelLabel(requestedModel, knownMetricModels);
```

When `rawRes.ok`, set:

```ts
          activeMetricModel = metricModel;
```

Use `activeMetricModel` for the streaming/non-streaming `provider_tokens_total` metric labels and for `stream_aborted_total`.

- [ ] **Step 7: Run proxy helper/e2e tests and verify GREEN**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/routes/proxy.test.ts -t "metricModelLabel"
bun test src/routes/proxy-e2e.test.ts -t "bounded model label"
```

Expected: both PASS.

- [ ] **Step 8: Run broader cloud proxy tests**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/routes/proxy.test.ts src/routes/proxy-e2e.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /Volumes/ROG_500GB/RouteBox
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/cloud-gateway/src/routes/proxy.ts apps/cloud-gateway/src/routes/proxy.test.ts apps/cloud-gateway/src/routes/proxy-e2e.test.ts
git commit -m "fix(cloud): bound provider metric model labels"
```

---

## Task 3: M1 — Bill and Record the Actual Served Model

**Files:**
- Modify: `apps/cloud-gateway/src/routes/proxy.ts`
- Modify: `apps/cloud-gateway/src/routes/proxy-e2e.test.ts`

- [ ] **Step 1: Make scoring mock configurable**

In `apps/cloud-gateway/src/routes/proxy-e2e.test.ts`, add near the top:

```ts
let mockScoredCandidates: any[] = [];
```

Change the scoring mock from a fixed empty array to:

```ts
mock.module("../lib/scoring-engine", () => ({
  scoreAndRank: async () => mockScoredCandidates,
}));
```

In `beforeEach()`, reset:

```ts
  mockScoredCandidates = [];
```

- [ ] **Step 2: Write the failing actual-served-model test**

Add this test in the T4 non-streaming describe block:

```ts
  test("M1: scoring fallback bills and records the actual served model", async () => {
    const app = createApp({ userPlan: "pro" });

    const providerConfig = {
      name: "TestProvider",
      instanceId: "test-1",
      baseUrl: "http://localhost:9999",
      apiKey: "test-key",
      format: "openai",
      prefixes: ["minimax-", "kimi-"],
    };
    mockScoredCandidates = [
      {
        modelId: "kimi-k2.5",
        providerConfigs: [providerConfig],
        isFallback: true,
        totalScore: 0.99,
      },
    ];

    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [], // disabled model check
    ];

    mockFetch(async (_url, init) => {
      const providerBody = JSON.parse(init!.body as string);
      expect(providerBody.model).toBe("kimi-k2.5");
      return new Response(JSON.stringify({
        ...PROVIDER_JSON_RESPONSE,
        model: providerBody.model,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await app.request("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CHAT_BODY),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body._routebox.routed_model).toBe("kimi-k2.5");
    expect(body._routebox.requested_model).toBe("minimax-m2.5");
    expect(body._routebox.is_fallback).toBe(true);

    expect(deductCalls).toHaveLength(1);
    expect((deductCalls[0][2] as any).model).toBe("kimi-k2.5");

    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0][1]).toBe("kimi-k2.5");

    const providerRequestMetric = metricCounterCalls.find(
      ([name, labels]) => name === "provider_requests_total" && (labels as any).status === "200",
    );
    expect((providerRequestMetric![1] as any).model).toBe("kimi-k2.5");
  });
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/routes/proxy-e2e.test.ts -t "actual served model"
```

Expected: FAIL because `_routebox`, `deductCredits`, and `recordCloudRequest` currently use `requestedModel`.

- [ ] **Step 4: Track the active served model**

In `apps/cloud-gateway/src/routes/proxy.ts`, after:

```ts
  let activeProvider: CloudProviderConfig | undefined;
```

add:

```ts
  let activeModel = requestedModel;
```

Inside the provider loop, after `const servedModel = scored._scoredModelId ?? requestedModel;`, make sure provider body rewrite uses the same value:

```ts
    if (scored._scoredModelId) {
      providerBody.model = servedModel;
      if (scored._isScoredFallback) isFallback = true;
    }
```

When `rawRes.ok`, set:

```ts
          activeModel = servedModel;
          isFallback = providerIdx > 0 || scored._isScoredFallback === true;
```

This replaces the existing success-path assignment:

```ts
          isFallback = providerIdx > 0;
```

Without this change, a scored fallback served by the first provider config is accounted against the right model but still reports `is_fallback: false`.

- [ ] **Step 5: Compute pricing after routing succeeds**

Remove the pre-routing pricing line:

```ts
  const modelPricing = await getModelUserPrice(requestedModel, userPlan);
```

After the `if (!res || !activeProvider) { ... }` block and before the retry metrics block, add:

```ts
  const modelPricing = await getModelUserPrice(activeModel, userPlan);
```

- [ ] **Step 6: Use `activeModel` for served-model accounting and metadata**

In the streaming `onDone` callback, replace:

```ts
model: requestedModel
deductCredits(userId, costCents, { model: requestedModel, ... })
recordCloudRequest(userId, requestedModel, ...)
```

with `activeModel` for cost/accounting records and metric labels:

```ts
model: activeMetricModel
deductCredits(userId, costCents, { model: activeModel, ... })
recordCloudRequest(userId, activeModel, ...)
```

When creating `streamMetaObj`, pass the served model as the transformer model and preserve the original request separately:

```ts
    const streamMetaObj: StreamMeta = {
      provider: activeProvider.name,
      requestedModel: activeModel,
      startMs,
      isFallback,
      autoRouted: isAutoRoute,
      originalRequestedModel: isAutoRoute ? "auto" : originalRequestedModel,
    };
```

Use `activeModel` in the transformer calls:

```ts
      ? anthropicStreamToOpenAI(res.body, activeModel, streamMetaObj, onDone)
      : openaiStreamPassthrough(res.body, streamMetaObj, onDone);
```

In the non-streaming branch:

- `providerCost = calculateCost(activeModel, inputTokens, outputTokens)`
- `deductCredits(... { model: activeModel, ... })`
- `recordCloudRequest(userId, activeModel, ...)`
- Anthropic transformed response `model: activeModel`
- `_routebox.routed_model: activeModel`
- `_routebox.requested_model: isAutoRoute ? "auto" : originalRequestedModel`
- `"X-RouteBox-Model": activeModel`

- [ ] **Step 7: Run the actual-served-model test and verify GREEN**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/routes/proxy-e2e.test.ts -t "actual served model"
```

Expected: PASS.

- [ ] **Step 8: Run proxy tests**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/routes/proxy.test.ts src/routes/proxy-e2e.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /Volumes/ROG_500GB/RouteBox
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/cloud-gateway/src/routes/proxy.ts apps/cloud-gateway/src/routes/proxy-e2e.test.ts
git commit -m "fix(cloud): account for actual served model after routing fallback"
```

---

## Task 4: L5 — Roll Back Starter Quota on Upstream 4xx

**Files:**
- Modify: `apps/cloud-gateway/src/routes/proxy.ts`
- Modify: `apps/cloud-gateway/src/routes/proxy-e2e.test.ts`

- [ ] **Step 1: Make quota mock observable**

In `apps/cloud-gateway/src/routes/proxy-e2e.test.ts`, add near other call collectors:

```ts
let decrementQuotaCalls: unknown[][] = [];
```

Change the quota mock to record decrement calls:

```ts
mock.module("../lib/quota", () => ({
  checkDailyQuota: async () => ({ allowed: true, remaining: Infinity, resetAt: new Date() }),
  incrementDailyQuota: async () => {},
  decrementDailyQuota: async (...args: unknown[]) => {
    decrementQuotaCalls.push(args);
  },
}));
```

Reset in `beforeEach()`:

```ts
  decrementQuotaCalls = [];
```

- [ ] **Step 2: Write the failing quota rollback test**

Add this test near the 4xx/5xx e2e tests:

```ts
describe("L5: Upstream 4xx quota rollback", () => {
  test("starter quota is decremented when provider returns non-retryable 4xx", async () => {
    const app = createApp({ userPlan: "starter" });

    // @ts-ignore
    globalThis.__dbMockSqlResults = [
      [], // disabled model check
    ];

    mockFetch(async () =>
      new Response(JSON.stringify({ error: { message: "bad request" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }));

    const res = await app.request("/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CHAT_BODY),
    });

    expect(res.status).toBe(400);
    expect(decrementQuotaCalls).toEqual([["test-user", "minimax-m2.5"]]);
    expect(deductCalls).toHaveLength(0);
    expect(recordCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/routes/proxy-e2e.test.ts -t "quota is decremented"
```

Expected: FAIL because non-retryable 4xx returns without `decrementDailyQuota`.

- [ ] **Step 4: Implement quota rollback helper**

In `apps/cloud-gateway/src/routes/proxy.ts`, after the request timeout setup, add:

```ts
  const rollbackQuota = (model: string) => {
    if (userPlan === "starter") decrementDailyQuota(userId, model).catch(() => {});
  };
```

Replace the all-providers-exhausted rollback:

```ts
    decrementDailyQuota(userId, requestedModel).catch(() => {});
```

with:

```ts
    rollbackQuota(requestedModel);
```

In the non-retryable 4xx branch, before `return c.json(...)`, add:

```ts
          rollbackQuota(requestedModel);
```

Use `requestedModel` because quota was checked/incremented before provider scoring rewrites. For `auto`, the earlier auto branch updates `requestedModel` to the selected model before quota check, so the same variable is correct.

- [ ] **Step 5: Run rollback test and verify GREEN**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/routes/proxy-e2e.test.ts -t "quota is decremented"
```

Expected: PASS.

- [ ] **Step 6: Run proxy e2e suite**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/routes/proxy-e2e.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/ROG_500GB/RouteBox
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/cloud-gateway/src/routes/proxy.ts apps/cloud-gateway/src/routes/proxy-e2e.test.ts
git commit -m "fix(cloud): roll back starter quota on upstream 4xx"
```

---

## Task 5: Final Verification

**Files:** no production edits.

- [ ] **Step 1: Run cloud route and metric tests**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
find . -name '._*' -delete 2>/dev/null
bun test src/lib/metrics.test.ts src/routes/proxy.test.ts src/routes/proxy-e2e.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run planned cloud regression set**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/key-pool.test.ts src/lib/metrics.test.ts src/lib/credits.test.ts src/routes/proxy-e2e.test.ts
```

Expected: PASS.

- [ ] **Step 3: Bundle proxy route**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun build src/routes/proxy.ts --target=bun --outdir=/tmp/cl-proxy-phase3a
```

Expected: bundle succeeds.

- [ ] **Step 4: Whitespace check**

Run:

```bash
cd /Volumes/ROG_500GB/RouteBox
git diff --check HEAD~4..HEAD
```

Expected: no output, exit 0.

- [ ] **Step 5: Final review**

Use `superpowers:requesting-code-review` if explicit subagent delegation is available/authorized; otherwise perform a local review of:

- every `provider_requests_total`, `provider_tokens_total`, and `stream_aborted_total` label uses bounded `activeMetricModel` / `metricModel`;
- every billing/accounting path after success uses `activeModel`;
- `_routebox.requested_model` preserves the user request while `_routebox.routed_model` shows the served model;
- 4xx returns call `rollbackQuota(requestedModel)` before returning;
- Prometheus label escaping covers `"`, `\`, and newline.

If review finds changes, fix with TDD and rerun the relevant tests before finalizing.
