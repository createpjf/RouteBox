# RouteBox Phase 2a — 网关路由/正确性 bug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复本地网关三个路由/正确性 bug —— fallback 重试成功后记错 provider(H1)、provider 三振后永不恢复(H3)、fallback 收到 4xx 仍当成功返回 200(M4),全部 TDD/带回归测试,不触碰流式结构。

**Architecture:** 改动集中在 `apps/gateway`:`routes/proxy.ts`(H1、M4 的重试控制流)与 `lib/metrics.ts`(H3 的 provider 健康判定)。H3 把「是否可用」抽成纯函数 `computeProviderUp(failStreak, lastFailure, now)` 便于无副作用单测,并加入恢复冷却(half-open)。

**Tech Stack:** TypeScript + Bun(`bun test`,gateway 全套现为 63/0)。测试用既有 `proxy.test.ts` 的 mock-server 夹具(`Bun.serve` on :19999)+ 新建 `metrics.test.ts`。

**Phase 2 拆分说明:** Phase 2 整体偏大,本计划是 **2a**(网关本地路由正确性,隔离、可测、低风险)。流式健壮性(H2 超时杀流、H4 断连/溢出、M8 abort 判定)与 SSE/适配器抽取到 `llm-core` 是 **2b**,另出计划——因为它需要把云端的流式修复抽成共享转换器,体量与风险都更大。

---

## 背景:三个 bug 的精确定位(已读码确认)

- **H1** `apps/gateway/src/routes/proxy.ts:535-564` 的 catch-重试路径:网络错误后 fallback 成功时只设了局部变量 `retriedProvider/retriedModel`,**没更新 `route`**。而后续 `:636-638` 的 `finalProvider/finalModel/finalIsFallback` 全部读 `route`(原失败 provider)。后果:流式分支按错的 `finalProvider.format` 选转换器(Anthropic→OpenAI fallback 会用错转换器产出乱流)、`recordRequest` 记错模型/provider、`X-RouteBox-Provider` 头撒谎。对照:5xx 重试路径 `:590` 用 `Object.assign(route, …)` 是对的,catch 路径漏了。
- **M4** `apps/gateway/src/routes/proxy.ts:587`:`if (retryRes.ok || retryRes.status < 500)` 把 fallback 的 4xx 当成功,落入正常处理 → 记为 success/fallback、以 HTTP 200 把错误体返回客户端。应仅 `retryRes.ok` 才继续。
- **H3** `apps/gateway/src/lib/metrics.ts:375-383` `isProviderUp` 返回 `failStreak < DOWN_FAIL_STREAK(=3)`;`failStreak` 只在成功记录时归零(`:176`)。但 router(`router.ts:105,238` 等)不会选 down 的 provider,故它永无机会成功 → 一次 3 连失败后永久禁用,直到重启。`getStats`(`:280`)也用同一判据。修复:加入恢复冷却——距 `lastFailure` 超过 `PROVIDER_RECOVERY_MS` 后重新视为可用(half-open),成功则 `failStreak` 归零、再失败则刷新 `lastFailure` 重新冷却。

**不在本期(留 2b):** H2(`forward` 的 `AbortSignal.timeout(30_000)` 杀长流)、H4(溢出后 enqueue 崩溃 + 断连不取消上游)、M8(client/timeout abort 不应记 provider down)。H3 的恢复冷却已先行缓解 M8 最坏后果(永久禁用 → 暂时)。

---

## File Structure

| 文件 | 责任 | 操作 |
|------|------|------|
| `apps/gateway/src/lib/metrics.ts` | provider 健康判定 + 恢复 | Modify(加 `PROVIDER_RECOVERY_MS`、`computeProviderUp`,改 `isProviderUp`/getStats) |
| `apps/gateway/src/lib/metrics.test.ts` | `computeProviderUp` 纯函数单测 | Create |
| `apps/gateway/src/routes/proxy.ts` | 重试控制流 | Modify(H1 catch-success 更新 route;M4 仅 ok 续) |
| `apps/gateway/src/routes/proxy.test.ts` | H1 集成测试 + M4 best-effort | Modify |

**执行者必读:**
- 测试:`cd apps/gateway && bun test <file>`;全套 `bun test`(现为 63/0)。提交前 `find . -path ./node_modules -prune -o -name '._*' -delete`。忽略 `non-monotonic index` git 警告。分支 `fix/audit-remediation`。
- `metrics` 是模块级单例,跨 test 文件共享;**不要**写会把某 provider 永久标 down 的测试(会污染同进程内 `proxy.test.ts`)。H3 因此用纯函数 `computeProviderUp` 单测,不碰单例。
- H1 集成测试需把某 provider 的 `baseUrl` 临时指向死端口;务必 `try/finally` 还原,避免泄漏到其它测试。

---

## Task 1: H3 —— provider 恢复冷却(纯函数 + TDD)

**Files:**
- Modify: `apps/gateway/src/lib/metrics.ts`
- Create: `apps/gateway/src/lib/metrics.test.ts`

- [ ] **Step 1: 写失败测试 `apps/gateway/src/lib/metrics.test.ts`**

```ts
import { test, expect } from "bun:test";
import { computeProviderUp, DOWN_FAIL_STREAK, PROVIDER_RECOVERY_MS } from "./metrics";

const T = 1_000_000; // 固定基准时间

test("healthy provider (failStreak below threshold) is up", () => {
  expect(computeProviderUp(0, 0, T)).toBe(true);
  expect(computeProviderUp(DOWN_FAIL_STREAK - 1, T, T)).toBe(true);
});

test("provider at/above fail threshold is down right after failure", () => {
  expect(computeProviderUp(DOWN_FAIL_STREAK, T, T)).toBe(false);
  expect(computeProviderUp(DOWN_FAIL_STREAK + 5, T, T)).toBe(false);
});

test("downed provider recovers (half-open) after recovery cooldown", () => {
  // 距 lastFailure 不足冷却时间 → 仍 down
  expect(computeProviderUp(DOWN_FAIL_STREAK, T, T + PROVIDER_RECOVERY_MS - 1)).toBe(false);
  // 达到冷却 → 重新可用,允许探测
  expect(computeProviderUp(DOWN_FAIL_STREAK, T, T + PROVIDER_RECOVERY_MS)).toBe(true);
  expect(computeProviderUp(DOWN_FAIL_STREAK, T, T + PROVIDER_RECOVERY_MS + 5000)).toBe(true);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && bun test src/lib/metrics.test.ts`
Expected: FAIL —— `computeProviderUp`/`PROVIDER_RECOVERY_MS` 未导出。

- [ ] **Step 3: 在 metrics.ts 加常量与纯函数**

在 `apps/gateway/src/lib/metrics.ts` 的 `const DOWN_FAIL_STREAK = 3;`(第 57 行)之后加入:
```ts
/** 标记 down 后,距上次失败多久重新视为可用(half-open 探测) */
export const PROVIDER_RECOVERY_MS = 60_000;
```
并把 `const DOWN_FAIL_STREAK = 3;` 改为 `export const DOWN_FAIL_STREAK = 3;`(测试需要导入)。

在文件中合适的模块作用域(类定义之外,例如紧接上述常量之后)加入纯函数:
```ts
/**
 * 判定 provider 是否可用(纯函数,便于测试)。
 * failStreak 未达阈值 → 可用;达阈值后,距 lastFailure 超过恢复冷却 → 重新可用(half-open)。
 */
export function computeProviderUp(failStreak: number, lastFailure: number, now: number): boolean {
  if (failStreak < DOWN_FAIL_STREAK) return true;
  return now - lastFailure >= PROVIDER_RECOVERY_MS;
}
```

- [ ] **Step 4: 让 `isProviderUp` 与 getStats 复用纯函数**

把 `isProviderUp`(约 `:375-383`)的结尾:
```ts
    const ps = this.providerState.get(name);
    if (!ps) return false;
    return ps.failStreak < DOWN_FAIL_STREAK;
  }
```
改为:
```ts
    const ps = this.providerState.get(name);
    if (!ps) return false;
    return computeProviderUp(ps.failStreak, ps.lastFailure, Date.now());
  }
```

把 `getStats` 里(约 `:280`):
```ts
      const isUp = ps.failStreak < DOWN_FAIL_STREAK;
```
改为:
```ts
      const isUp = computeProviderUp(ps.failStreak, ps.lastFailure, Date.now());
```

(成功时 `failStreak` 归零的逻辑 `:176` 已存在,无需改;恢复后被选中→成功即彻底复位,失败则 `record()`/`markProviderDown` 刷新 `lastFailure` 重新冷却。)

- [ ] **Step 5: 运行确认通过**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && bun test src/lib/metrics.test.ts`
Expected: PASS(3 tests）

- [ ] **Step 6: 全套回归(确认未破坏既有)**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && rm -f /tmp/routebox-test-db.sqlite* 2>/dev/null; bun test`
Expected: 全 PASS(原 63 + 新 3 = 66)。

- [ ] **Step 7: Commit**

```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/gateway/src/lib/metrics.ts apps/gateway/src/lib/metrics.test.ts
git commit -m "fix(gateway): provider recovery cooldown so 3-strike-down self-heals (H3)"
```

---

## Task 2: M4 —— fallback 仅在 ok 时续,否则返回上游错误状态

**Files:**
- Modify: `apps/gateway/src/routes/proxy.ts`

- [ ] **Step 1: 收紧 5xx 重试的成功判据**

把 `apps/gateway/src/routes/proxy.ts:587` 起的块:
```ts
          const retryRes = await forward(fallback.provider, body);
          if (retryRes.ok || retryRes.status < 500) {
            // Retry succeeded — continue with this response
            res = retryRes;
            Object.assign(route, { provider: fallback.provider, model: fallback.model, isFallback: true });
            // Fall through to normal response handling below
          } else {
```
改为(仅 2xx 才视为成功;4xx/5xx 都走错误返回):
```ts
          const retryRes = await forward(fallback.provider, body);
          if (retryRes.ok) {
            // Retry succeeded — continue with this response
            res = retryRes;
            Object.assign(route, { provider: fallback.provider, model: fallback.model, isFallback: true });
            // Fall through to normal response handling below
          } else {
```
其余(else 分支记 error 并返回 502/上游错误)保持不变 —— 现在 4xx 也会走该分支,把真实状态/错误体返回,而不是伪装成 200 成功。

- [ ] **Step 2: 解析/打包验证**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && bun build src/routes/proxy.ts --target=bun --outdir=/tmp/gw-proxy-m4`
Expected: bundle 成功。

- [ ] **Step 3: best-effort 集成测试(若可行)**

说明:用当前测试 provider 配置(每个显式模型仅一个 provider),5xx→跨 provider→4xx 这一具体分支很难确定性触发(`selectRoute(requestedModel,"quality_first")` 多半返回同一 canonical → 不重试)。因此:
- 先尝试构造:在 `proxy.test.ts` 的 mock 中按 `body.model` 返回 503(主)与 400(备),并通过 `metrics.markProviderDown` 让 canonical 暂时不可用以迫使跨 provider 选择;在 try/finally 中恢复(对该 provider record 一次成功以复位 failStreak,或依赖 H3 冷却)。
- 若经合理尝试无法确定性触发该分支(routing 不产生跨 provider fallback),**不要**伪造测试。改为在测试文件中加一条注释记录该分支的局限,并在报告里说明「M4 经代码审查验证:`retryRes.ok || status<500` → `retryRes.ok`,仅收窄成功集合,4xx 改走既有 else 返回上游状态;无新风险」。

具体若可行,加入此测试到 `proxy.test.ts` 的 describe 块内(按需调整 model 名使其路由到可控 provider):
```ts
  test("M4: fallback returning 4xx is surfaced as an error, not a 200", async () => {
    // 该测试依赖 mock 按 model 返回 503(主)/400(备)且 routing 产生跨 provider fallback。
    // 若当前 provider 配置无法触发跨 provider 重试,跳过并依赖代码审查(见计划 Task 2 Step 3)。
    // 实现者:仅在能确定性触发时保留断言,否则删除此 test 并在报告说明。
  });
```

- [ ] **Step 4: 全套回归**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && rm -f /tmp/routebox-test-db.sqlite* 2>/dev/null; bun test`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/gateway/src/routes/proxy.ts apps/gateway/src/routes/proxy.test.ts
git commit -m "fix(gateway): fallback only succeeds on 2xx; 4xx returns upstream error (M4)"
```

---

## Task 3: H1 —— catch-重试成功后更新 route(集成测试)

**Files:**
- Modify: `apps/gateway/src/routes/proxy.ts`
- Modify: `apps/gateway/src/routes/proxy.test.ts`

- [ ] **Step 1: 写失败的集成测试**

在 `apps/gateway/src/routes/proxy.test.ts` 的 `describe("POST /v1/chat/completions", ...)` 内加入。思路:把 Anthropic 的 `baseUrl` 临时指向死端口,使请求 `claude-*` 时主 provider fetch 抛错 → catch 重试经 `quality_first` 选到一个 OpenAI 形态 provider(指向 mock)成功。修复前:`finalProvider` 仍是 Anthropic(format=anthropic),响应被 `fromAnthropicResponse` 误处理且 `X-RouteBox-Provider: Anthropic`;修复后:头部为实际成功的 OpenAI 形态 provider,且响应正常。

```ts
  test("H1: network-error fallback records the provider that actually served it", async () => {
    const { providers } = await import("../lib/providers");
    const anthropic = providers.find((p) => p.name === "Anthropic");
    if (!anthropic) {
      // 无 Anthropic provider(env 未配)→ 跳过
      return;
    }
    const originalBaseUrl = anthropic.baseUrl;
    anthropic.baseUrl = "http://127.0.0.1:1/v1"; // 死端口 → fetch 抛错
    try {
      const res = await proxyRequest({
        model: "claude-3-haiku-20240307",
        messages: [{ role: "user", content: "Hello" }],
      });
      // 重试成功 → 200,且不再自称 Anthropic
      expect(res.status).toBe(200);
      const served = res.headers.get("X-RouteBox-Provider");
      expect(served).not.toBe("Anthropic");
      const json = await res.json() as any;
      // 来自 OpenAI 形态 mock 的正常响应(未被 Anthropic 转换器破坏)
      expect(json.choices[0].message.content).toBe("Hello from mock!");
      expect(json._routebox.provider).toBe(served!.toLowerCase());
      expect(json._routebox.is_fallback).toBe(true);
    } finally {
      anthropic.baseUrl = originalBaseUrl;
    }
  });
```
注意:此测试会因网络错误对 Anthropic 调用 `markProviderDown`(失败计 1 次,<3,不会 down);为稳妥,测试末尾(finally 内,恢复 baseUrl 后)无需额外复位。若担心顺序影响,可在 finally 里对 Anthropic 记一次成功——但通常 1 次失败无害,优先保持测试简单。

- [ ] **Step 2: 运行确认失败(暴露 bug)**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && rm -f /tmp/routebox-test-db.sqlite* 2>/dev/null; bun test src/routes/proxy.test.ts -t "H1"`
Expected: FAIL —— 修复前 `X-RouteBox-Provider` 仍为 `Anthropic`(或响应被 Anthropic 转换器破坏),断言不通过。
若该测试因环境未配 Anthropic 而直接 return 通过,STOP 上报:需要另寻可触发 catch-重试且跨 format 的配置;不要在缺少有效断言时继续。

- [ ] **Step 3: 修复 catch-重试成功路径**

把 `apps/gateway/src/routes/proxy.ts:546-557`(catch 内的 fallback 重试):
```ts
        try {
          body.model = fallback.model;
          if (isStream && fallback.provider.format === "openai" && !fallback.provider.isLocal) {
            body.stream_options = { include_usage: true };
          }
          res = await forward(fallback.provider, body);
          retriedProvider = fallback.provider;
          retriedModel = fallback.model;
        } catch {
          metrics.markProviderDown(fallback.provider.name);
        }
```
改为(成功后把 `route` 更新为实际服务的 provider/model,与 5xx 路径一致,使后续 `finalProvider/finalModel/finalIsFallback` 正确):
```ts
        try {
          body.model = fallback.model;
          if (isStream && fallback.provider.format === "openai" && !fallback.provider.isLocal) {
            body.stream_options = { include_usage: true };
          }
          res = await forward(fallback.provider, body);
          Object.assign(route, { provider: fallback.provider, model: fallback.model, isFallback: true });
          retriedProvider = fallback.provider;
          retriedModel = fallback.model;
        } catch {
          metrics.markProviderDown(fallback.provider.name);
        }
```
(保留 `retriedProvider/retriedModel` 不动 —— 它们仍被 `:567-569` 的 `activeProvider/activeModel/activeIsFallback` 用于 `!res.ok` 错误分支;现在 `route` 与它们一致。)

- [ ] **Step 4: 运行确认通过**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && rm -f /tmp/routebox-test-db.sqlite* 2>/dev/null; bun test src/routes/proxy.test.ts -t "H1"`
Expected: PASS。

- [ ] **Step 5: 全套回归**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && rm -f /tmp/routebox-test-db.sqlite* 2>/dev/null; bun test`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/gateway/src/routes/proxy.ts apps/gateway/src/routes/proxy.test.ts
git commit -m "fix(gateway): update route on network-error fallback so served provider is recorded (H1)"
```

---

## Task 4: Final —— 全量回归 + 终审

- [ ] **Step 1: gateway 全套**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && rm -f /tmp/routebox-test-db.sqlite* 2>/dev/null; find . -name '._*' -delete 2>/dev/null; bun test`
Expected: 全 PASS(≥66,取决于 M4 测试是否保留)。

- [ ] **Step 2: 派终审 reviewer**

对 Phase 2a commit 范围做评审,重点:(a) H1 修复后 catch-成功与 5xx-成功两条路径对 `route` 的更新一致,`finalProvider/finalModel/finalIsFallback` 在所有路径都指向实际服务者;(b) M4 收窄后 4xx 不再被当成功,且 else 分支正确返回上游状态;(c) H3 `computeProviderUp` 逻辑正确、`isProviderUp`/getStats 都已切换、成功复位路径完好;(d) 无新增竞态或回归。

---

## Self-Review notes(作者自检)

- **范围:** 本期仅 H1/M4/H3,均 gateway 本地、隔离可测;H2/H4/M8 明确留 2b(需 SSE 抽取到 llm-core,体量/风险更大)。
- **零副作用测试:** H3 用纯函数 `computeProviderUp` 单测,绝不把单例 provider 永久标 down;H1 集成测试用 try/finally 还原 baseUrl。两者都不会破坏现在 63/0 的全套。
- **M4 诚实性:** 该 bug 的具体重试分支在当前单 provider/模型配置下难以确定性触发;计划要求实现者要么给出能触发的确定性测试,要么删测并在报告里以代码审查论证(改动仅收窄成功集合,无新风险)——不得伪造测试。
- **H1 论证:** 修复使 catch-重试成功路径与既有 5xx 路径(`:590`)对 `route` 的处理一致;`finalProvider/finalModel/finalIsFallback`(`:636-638`)随之正确,流式转换器选型、计费、响应头同时被修正。
- **依赖:** 不依赖 Phase 2b;可独立合并。
