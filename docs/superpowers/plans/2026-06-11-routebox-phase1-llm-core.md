# RouteBox Phase 1 — `packages/llm-core` 共享包(机制层)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 `packages/llm-core` 共享包,把两端**真正相同的机制**(定价算法、共享类型、alias 解析)收敛为单一来源,两端各自传入自己的数据 —— 行为零变化,并为 Phase 2/3 提供落脚点。

**Architecture:** 关键发现——gateway 与 cloud-gateway 的 `PROVIDER_REGISTRY`、`MODEL_PRICING` 是**真实不同的数据/策略**(gateway 7 个 provider 的本地 BYOK + 列表价用于成本展示;cloud 10 个 provider 的池化服务 + 议价用于计费),不是简单拷贝漂移。因此 Phase 1 只共享**机制**(纯函数 + 类型),数据(registry 列表、pricing 表)留在各 app。adapter(`toAnthropicRequest`)与 SSE 转换器在两端已**行为性分叉**(cloud 的精简适配器丢 tools/images、cloud 的 SSE 含 H4 修复),它们的统一 = Phase 2 的 bug 修复,本期不动。

**Tech Stack:** TypeScript + Bun(`bun test`,`bun build` 验证解析/打包)、pnpm workspace。共享包为**源码包**(无构建步骤,Bun 直接跑 TS),通过各 app tsconfig 的 `paths` 别名解析(沿用仓库已有的 `@gateway/*` 模式),磁盘安全、无需 `pnpm install`。

---

## 范围边界(本期做 / 不做)

**做(零行为变化):**
- 新建 `packages/llm-core` 源码包 + workspace 接线 + tsconfig 路径解析。
- 共享 **类型**:`ProviderFormat`、`ProviderTemplate`、`ModelPricing`。
- 共享 **定价算法**:`pricingForModel(model, table, opts?)`、`calculateCost(...)` —— 数据由各 app 注入。
- 共享 **alias 解析**:`resolveAlias(model, table)`。
- 两端 `providers.ts` / `proxy.ts` / `key-pool.ts` 改为 import 共享机制 + 薄包装(保留各自数据与全部调用点签名,diff 最小)。

**不做(留待后续 Phase):**
- 统一 `PROVIDER_REGISTRY` 列表或 prefix(真实不同,合并会改路由)。
- 统一 `MODEL_PRICING` 数字(真实不同,合并会改计费/成本展示)。
- Anthropic 适配器(`toAnthropicRequest`/`fromAnthropicResponse`)统一 —— Phase 2 随 SSE/流式修复一起做(cloud 精简版丢 tools/images 是 Phase 2 的 bug)。
- SSE 转换器统一 —— Phase 2(H4 流式修复)。
- provider 匹配(longest-prefix + cloud 的 round-robin/熔断 + gateway 的 local/DB 合并)—— 两端逻辑不同,本期不抽。

---

## File Structure

| 文件 | 责任 | 操作 |
|------|------|------|
| `pnpm-workspace.yaml` | workspace 包含 packages/* | Modify |
| `packages/llm-core/package.json` | 包声明(源码包) | Create |
| `packages/llm-core/tsconfig.json` | 包 tsconfig | Create |
| `packages/llm-core/src/index.ts` | barrel 导出 | Create |
| `packages/llm-core/src/types.ts` | ProviderFormat/ProviderTemplate/ModelPricing | Create |
| `packages/llm-core/src/pricing.ts` | pricingForModel/calculateCost(数据注入) | Create |
| `packages/llm-core/src/pricing.test.ts` | 定价算法单测 | Create |
| `packages/llm-core/src/aliases.ts` | resolveAlias(数据注入) | Create |
| `packages/llm-core/src/aliases.test.ts` | alias 单测 | Create |
| `apps/gateway/tsconfig.json` | 加 `@routebox/llm-core` 路径 | Modify |
| `apps/gateway/src/lib/providers.ts` | import 核心定价/alias/类型 + 薄包装 | Modify |
| `apps/cloud-gateway/tsconfig.json` | 加 `@routebox/llm-core` 路径 | Modify |
| `apps/cloud-gateway/src/routes/proxy.ts` | pricingFor/calculateCost 改用核心 | Modify |
| `apps/cloud-gateway/src/lib/key-pool.ts` | ProviderTemplate 类型改用核心 | Modify |

**执行者必读:**
- 测试:`cd packages/llm-core && bun test`;`cd apps/gateway && bun test <file>`;`cd apps/cloud-gateway && bun test <file>`。
- 解析/打包验证:`bun build <entry> --target=bun --outdir=/tmp/<x>`(能 bundle 即说明 import 解析成功,无需 typecheck 工具链)。
- 磁盘:`/Volumes/ROG_500GB` 卷接近满,**不要运行 `pnpm install`**(本期靠 tsconfig paths,无需安装);也不要为腾空间删用户数据。忽略 `non-monotonic index` git 警告。
- gateway 测试套件有**预存的多文件隔离问题**(`db.test.ts`/`proxy.test.ts` 单跑通过、合跑失败,源于模块级单例 + bun preload),非本期引入;验证一律**单文件**运行。
- 提交前清 AppleDouble:`find . -path ./node_modules -prune -o -name '._*' -delete`。

---

## Task 1: 脚手架 `packages/llm-core` + workspace 接线 + 解析冒烟

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `packages/llm-core/package.json`, `packages/llm-core/tsconfig.json`, `packages/llm-core/src/index.ts`
- Modify: `apps/gateway/tsconfig.json`
- Create: `packages/llm-core/src/__smoke.test.ts`(临时,本任务末删除)

- [ ] **Step 1: workspace 包含 packages/***

把 `pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*

ignoredBuiltDependencies:
  - esbuild
```
改为:
```yaml
packages:
  - apps/*
  - packages/*

ignoredBuiltDependencies:
  - esbuild
```

- [ ] **Step 2: 创建 `packages/llm-core/package.json`**

```json
{
  "name": "@routebox/llm-core",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "bun test"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

- [ ] **Step 3: 创建 `packages/llm-core/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["bun"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 创建 `packages/llm-core/src/index.ts`(初始仅一个冒烟导出)**

```ts
// ---------------------------------------------------------------------------
// @routebox/llm-core — 两端共享的 LLM 机制(类型 / 定价算法 / alias)
// 数据(registry 列表、pricing 表)由各 app 注入,不在本包内。
// ---------------------------------------------------------------------------

/** 冒烟用,确认跨包解析可用;Task 2 起被真实导出替换。 */
export const LLM_CORE_VERSION = "1.0.0";
```

- [ ] **Step 5: 给 gateway tsconfig 加路径别名**

`apps/gateway/tsconfig.json` 当前没有 `paths`。把:
```json
    "esModuleInterop": true,
    "types": ["bun"]
  },
  "include": ["src"]
```
改为:
```json
    "esModuleInterop": true,
    "types": ["bun"],
    "paths": {
      "@routebox/llm-core": ["../../packages/llm-core/src/index.ts"]
    }
  },
  "include": ["src"]
```

- [ ] **Step 6: 冒烟测试 —— 确认 Bun 能经 tsconfig paths 跨包解析**

Create `packages/llm-core/src/__smoke.test.ts`:
```ts
import { test, expect } from "bun:test";
import { LLM_CORE_VERSION } from "./index";

test("package resolves locally", () => {
  expect(LLM_CORE_VERSION).toBe("1.0.0");
});
```
Also create a temporary resolution probe in the gateway to confirm the `@routebox/llm-core` alias resolves at runtime. Create `apps/gateway/src/__smoke.test.ts`:
```ts
import { test, expect } from "bun:test";
import { LLM_CORE_VERSION } from "@routebox/llm-core";

test("gateway resolves @routebox/llm-core via tsconfig paths", () => {
  expect(LLM_CORE_VERSION).toBe("1.0.0");
});
```
Run:
```
cd /Volumes/ROG_500GB/RouteBox/packages/llm-core && bun test src/__smoke.test.ts
cd /Volumes/ROG_500GB/RouteBox/apps/gateway && bun test src/__smoke.test.ts
```
Expected: both PASS.
**If the gateway probe FAILS to resolve `@routebox/llm-core`:** Bun isn't honoring tsconfig `paths` here. STOP and report — the fallback is to add `"@routebox/llm-core": "workspace:*"` to `apps/gateway/package.json` dependencies and run `pnpm install` (only viable if disk space allows). Do not silently switch approaches; report so the controller decides.

- [ ] **Step 7: 删除两个 `__smoke.test.ts` 探针**

```bash
rm apps/gateway/src/__smoke.test.ts packages/llm-core/src/__smoke.test.ts
```
(`index.ts` 的 `LLM_CORE_VERSION` 保留——无害,且作为包非空的占位,Task 2 会在其旁追加真实导出。)

- [ ] **Step 8: Commit**

```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add pnpm-workspace.yaml packages/llm-core/package.json packages/llm-core/tsconfig.json packages/llm-core/src/index.ts apps/gateway/tsconfig.json
git commit -m "feat(llm-core): scaffold shared package + tsconfig path resolution (Phase 1)"
```

---

## Task 2: 共享类型 `types.ts`

**Files:**
- Create: `packages/llm-core/src/types.ts`
- Modify: `packages/llm-core/src/index.ts`

- [ ] **Step 1: 创建 `packages/llm-core/src/types.ts`**

类型与两端现有定义**逐字段一致**(gateway `providers.ts` 的 `ProviderTemplate`、cloud `key-pool.ts` 的 `ProviderTemplate` 同形;`ModelPricing` 即两端 `{ input; output }`)。

```ts
// ---------------------------------------------------------------------------
// 共享类型 —— 与两端现有定义逐字段一致(纯类型,运行时零影响)
// ---------------------------------------------------------------------------

/** Provider API 形态 —— 除 Anthropic 外都讲 OpenAI 协议 */
export type ProviderFormat = "openai" | "anthropic";

/** 静态 provider 模板(元数据,不含 key)—— gateway 与 cloud 同形 */
export interface ProviderTemplate {
  name: string;
  envKey: string;
  baseUrlEnvKey: string;
  defaultBaseUrl: string;
  prefixes: string[];
  format: ProviderFormat;
  /** 自定义 auth header 名(默认 "Authorization" + "Bearer " 前缀) */
  authHeader?: string;
}

/** 每 100 万 token 的输入/输出价格 */
export interface ModelPricing {
  input: number;
  output: number;
}
```

- [ ] **Step 2: 从 index 导出**

把 `packages/llm-core/src/index.ts` 末尾追加:
```ts

export type { ProviderFormat, ProviderTemplate, ModelPricing } from "./types";
```

- [ ] **Step 3: 解析验证**

Run: `cd /Volumes/ROG_500GB/RouteBox/packages/llm-core && bun build src/index.ts --target=bun --outdir=/tmp/llmcore-t2`
Expected: bundle 成功,无错误。

- [ ] **Step 4: Commit**

```bash
git add packages/llm-core/src/types.ts packages/llm-core/src/index.ts
git commit -m "feat(llm-core): shared types (ProviderFormat, ProviderTemplate, ModelPricing)"
```

---

## Task 3: 共享定价算法 `pricing.ts`(TDD)

**Files:**
- Create: `packages/llm-core/src/pricing.ts`, `packages/llm-core/src/pricing.test.ts`
- Modify: `packages/llm-core/src/index.ts`

**关键不变量:** 核心函数必须能**化简为两端各自当前行为**:
- gateway `pricingForModel(model, providerName?)`:顺序 = free-provider(Ollama/LM Studio)→ provider 专属覆盖 → 精确表命中 → 前缀命中 → `{1,3}`。
- cloud `pricingFor(model)`:精确表命中 → 前缀命中 → `{1,3}`(无 free/覆盖)。

- [ ] **Step 1: 写失败测试 `packages/llm-core/src/pricing.test.ts`**

```ts
import { test, expect } from "bun:test";
import { pricingForModel, calculateCost } from "./pricing";
import type { ModelPricing } from "./types";

const TABLE: Record<string, ModelPricing> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
};

test("exact table hit", () => {
  expect(pricingForModel("gpt-4o", TABLE)).toEqual({ input: 2.5, output: 10 });
});

test("prefix match (longest key that prefixes the model)", () => {
  expect(pricingForModel("gpt-4o-2024-08-06", TABLE)).toEqual({ input: 2.5, output: 10 });
});

test("default fallback {1,3} when no match", () => {
  expect(pricingForModel("totally-unknown", TABLE)).toEqual({ input: 1, output: 3 });
});

test("custom fallback honored", () => {
  expect(pricingForModel("unknown", TABLE, { fallback: { input: 0.5, output: 0.5 } }))
    .toEqual({ input: 0.5, output: 0.5 });
});

test("free providers short-circuit to zero", () => {
  expect(pricingForModel("gpt-4o", TABLE, { providerName: "Ollama", freeProviders: ["Ollama", "LM Studio"] }))
    .toEqual({ input: 0, output: 0 });
});

test("provider-specific override beats table", () => {
  const overrides = { "FLock.io": { "gpt-4o": { input: 9, output: 9 } } };
  expect(pricingForModel("gpt-4o", TABLE, { providerName: "FLock.io", providerOverrides: overrides }))
    .toEqual({ input: 9, output: 9 });
});

test("override only applies to the named provider", () => {
  const overrides = { "FLock.io": { "gpt-4o": { input: 9, output: 9 } } };
  expect(pricingForModel("gpt-4o", TABLE, { providerName: "OpenAI", providerOverrides: overrides }))
    .toEqual({ input: 2.5, output: 10 });
});

test("calculateCost uses (in*input + out*output)/1e6", () => {
  // 1000 in * 2.5 + 2000 out * 10 = 2500 + 20000 = 22500 ; /1e6 = 0.0225
  expect(calculateCost("gpt-4o", 1000, 2000, TABLE)).toBeCloseTo(0.0225, 10);
});

test("reduces to cloud behavior (no opts): exact then prefix then {1,3}", () => {
  expect(pricingForModel("claude-sonnet-4-20250514", TABLE)).toEqual({ input: 3, output: 15 });
  expect(pricingForModel("nope", TABLE)).toEqual({ input: 1, output: 3 });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Volumes/ROG_500GB/RouteBox/packages/llm-core && bun test src/pricing.test.ts`
Expected: FAIL —— `Cannot find module './pricing'`。

- [ ] **Step 3: 实现 `packages/llm-core/src/pricing.ts`**

```ts
// ---------------------------------------------------------------------------
// 定价算法 —— 纯函数,定价表由调用方注入(数据留在各 app)
// ---------------------------------------------------------------------------

import type { ModelPricing } from "./types";

export interface PricingOptions {
  /** 当前 provider 名,用于 free / override 判定 */
  providerName?: string;
  /** provider 专属价格覆盖:{ [providerName]: { [model]: ModelPricing } } */
  providerOverrides?: Record<string, Record<string, ModelPricing>>;
  /** 视为免费($0)的 provider 名(如本地 Ollama / LM Studio) */
  freeProviders?: string[];
  /** 无命中时的兜底价(默认 { input: 1, output: 3 }) */
  fallback?: ModelPricing;
}

/**
 * 解析某模型的价格。判定顺序:
 * free-provider → provider 专属覆盖 → 精确表命中 → 前缀命中 → fallback。
 * 不传 opts 时即「精确 → 前缀 → {1,3}」,与 cloud 当前 `pricingFor` 等价。
 */
export function pricingForModel(
  model: string,
  table: Record<string, ModelPricing>,
  opts: PricingOptions = {},
): ModelPricing {
  const { providerName, providerOverrides, freeProviders, fallback = { input: 1, output: 3 } } = opts;

  if (providerName && freeProviders?.includes(providerName)) {
    return { input: 0, output: 0 };
  }
  if (providerName && providerOverrides?.[providerName]?.[model]) {
    return providerOverrides[providerName][model];
  }
  if (table[model]) return table[model];
  for (const [key, val] of Object.entries(table)) {
    if (model.startsWith(key)) return val;
  }
  return fallback;
}

/** 由 token 数算成本(USD)。公式与两端一致。 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  table: Record<string, ModelPricing>,
  opts?: PricingOptions,
): number {
  const p = pricingForModel(model, table, opts);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /Volumes/ROG_500GB/RouteBox/packages/llm-core && bun test src/pricing.test.ts`
Expected: PASS(9 tests）

- [ ] **Step 5: 从 index 导出**

`packages/llm-core/src/index.ts` 追加:
```ts
export { pricingForModel, calculateCost, type PricingOptions } from "./pricing";
```

- [ ] **Step 6: Commit**

```bash
git add packages/llm-core/src/pricing.ts packages/llm-core/src/pricing.test.ts packages/llm-core/src/index.ts
git commit -m "feat(llm-core): data-injected pricing algorithm (pricingForModel, calculateCost)"
```

---

## Task 4: 共享 alias 解析 `aliases.ts`(TDD)

**Files:**
- Create: `packages/llm-core/src/aliases.ts`, `packages/llm-core/src/aliases.test.ts`
- Modify: `packages/llm-core/src/index.ts`

- [ ] **Step 1: 写失败测试 `packages/llm-core/src/aliases.test.ts`**

```ts
import { test, expect } from "bun:test";
import { resolveAlias } from "./aliases";

test("maps a known alias", () => {
  expect(resolveAlias("claude-haiku", { "claude-haiku": "claude-haiku-4-20250514" }))
    .toBe("claude-haiku-4-20250514");
});

test("passes through unknown model", () => {
  expect(resolveAlias("gpt-4o", { "claude-haiku": "x" })).toBe("gpt-4o");
});

test("empty table is identity (cloud behavior)", () => {
  expect(resolveAlias("anything", {})).toBe("anything");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Volumes/ROG_500GB/RouteBox/packages/llm-core && bun test src/aliases.test.ts`
Expected: FAIL —— module not found。

- [ ] **Step 3: 实现 `packages/llm-core/src/aliases.ts`**

```ts
// ---------------------------------------------------------------------------
// Model alias 解析 —— 别名表由调用方注入(gateway 有表,cloud 传空表)
// ---------------------------------------------------------------------------

/** 把用户给的模型名按别名表解析为规范 ID;无命中则原样返回。 */
export function resolveAlias(model: string, aliases: Record<string, string>): string {
  return aliases[model] ?? model;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd /Volumes/ROG_500GB/RouteBox/packages/llm-core && bun test src/aliases.test.ts`
Expected: PASS(3 tests）

- [ ] **Step 5: 从 index 导出 + 完整包测试**

`packages/llm-core/src/index.ts` 追加:
```ts
export { resolveAlias } from "./aliases";
```
Run: `cd /Volumes/ROG_500GB/RouteBox/packages/llm-core && bun test`
Expected: PASS(pricing 9 + aliases 3 = 12 tests）。

- [ ] **Step 6: Commit**

```bash
git add packages/llm-core/src/aliases.ts packages/llm-core/src/aliases.test.ts packages/llm-core/src/index.ts
git commit -m "feat(llm-core): data-injected alias resolver"
```

---

## Task 5: gateway 改用共享机制(薄包装,零行为变化)

**Files:**
- Modify: `apps/gateway/src/lib/providers.ts`

**策略:** 保留 gateway 的全部数据(`MODEL_PRICING`、`PROVIDER_MODEL_PRICING`、`MODEL_ALIASES`、`PROVIDER_REGISTRY`)与所有导出名,把**算法/类型**换成从核心 import,导出薄包装。这样 gateway 其余文件(proxy.ts 等)对 `./providers` 的 import 全部不变。

- [ ] **Step 1: 顶部 import 核心**

`apps/gateway/src/lib/providers.ts` 第 5 行(`import { getLocalProviderForModel, ... } from "./local-providers";`)之后,加:
```ts
import {
  pricingForModel as corePricingForModel,
  calculateCost as coreCalculateCost,
  resolveAlias as coreResolveAlias,
  type ModelPricing,
  type ProviderTemplate as CoreProviderTemplate,
} from "@routebox/llm-core";
```

- [ ] **Step 2: `ProviderTemplate` 接口改为复用核心类型**

把本地接口定义(约 121-130 行):
```ts
export interface ProviderTemplate {
  name: string;
  envKey: string;
  baseUrlEnvKey: string;
  defaultBaseUrl: string;
  prefixes: string[];
  format: "openai" | "anthropic";
  /** Custom auth header name (default: "Authorization" with "Bearer " prefix) */
  authHeader?: string;
}
```
替换为(保持导出名 `ProviderTemplate` 不变,供本文件 `PROVIDER_REGISTRY: ProviderTemplate[]` 及其它文件使用):
```ts
export type ProviderTemplate = CoreProviderTemplate;
```

- [ ] **Step 3: `pricingForModel` 改为薄包装(行为不变)**

把现有实现(约 316-332 行):
```ts
export function pricingForModel(model: string, providerName?: string): { input: number; output: number } {
  // Local providers are always free
  if (providerName === "Ollama" || providerName === "LM Studio") {
    return { input: 0, output: 0 };
  }
  // Check provider-specific pricing override first
  if (providerName && PROVIDER_MODEL_PRICING[providerName]?.[model]) {
    return PROVIDER_MODEL_PRICING[providerName][model];
  }
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // try prefix match (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return val;
  }
  return { input: 1, output: 3 }; // fallback estimate
}
```
替换为:
```ts
export function pricingForModel(model: string, providerName?: string): ModelPricing {
  return corePricingForModel(model, MODEL_PRICING, {
    providerName,
    providerOverrides: PROVIDER_MODEL_PRICING,
    freeProviders: ["Ollama", "LM Studio"],
    fallback: { input: 1, output: 3 },
  });
}
```

- [ ] **Step 4: `calculateCost` 改为薄包装**

把现有实现(约 334-343 行):
```ts
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  providerName?: string,
): number {
  const p = pricingForModel(model, providerName);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
```
替换为:
```ts
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  providerName?: string,
): number {
  return coreCalculateCost(model, inputTokens, outputTokens, MODEL_PRICING, {
    providerName,
    providerOverrides: PROVIDER_MODEL_PRICING,
    freeProviders: ["Ollama", "LM Studio"],
    fallback: { input: 1, output: 3 },
  });
}
```

- [ ] **Step 5: `resolveModelAlias` 改为薄包装**

把(约 41-44 行):
```ts
/** Resolve a user-provided model name to the canonical model ID */
export function resolveModelAlias(model: string): string {
  return MODEL_ALIASES[model] ?? model;
}
```
替换为:
```ts
/** Resolve a user-provided model name to the canonical model ID */
export function resolveModelAlias(model: string): string {
  return coreResolveAlias(model, MODEL_ALIASES);
}
```
注意:`MODEL_ALIASES` 定义在该函数下方(约 26-39 行),JS 函数体在调用时才求值,提升后仍可访问,无需移动。

- [ ] **Step 6: 解析/打包验证**

Run: `cd /Volumes/ROG_500GB/RouteBox/apps/gateway && bun build src/lib/providers.ts --target=bun --outdir=/tmp/gw-providers`
Expected: bundle 成功(证明 `@routebox/llm-core` 解析正常、无类型/语法错误)。

- [ ] **Step 7: 行为回归 —— 单文件运行相关测试**

Run:
```
cd /Volumes/ROG_500GB/RouteBox/apps/gateway
bun test src/lib/providers.test.ts
bun test src/lib/router.test.ts
bun test src/routes/proxy.test.ts
```
Expected: 各自全部 PASS(单跑;`providers.test.ts` 覆盖 pricing/registry,`proxy.test.ts` 用到 calculateCost)。若某测试断言了具体价格/成本数值,结果必须与改动前**完全一致**(零行为变化)。

- [ ] **Step 8: Commit**

```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/gateway/src/lib/providers.ts
git commit -m "refactor(gateway): use @routebox/llm-core pricing/alias/types (no behavior change)"
```

---

## Task 6: cloud-gateway 改用共享机制(薄包装,零行为变化)

**Files:**
- Modify: `apps/cloud-gateway/tsconfig.json`
- Modify: `apps/cloud-gateway/src/routes/proxy.ts`
- Modify: `apps/cloud-gateway/src/lib/key-pool.ts`

- [ ] **Step 1: cloud tsconfig 加路径别名**

`apps/cloud-gateway/tsconfig.json` 已有 `paths` 块。把:
```json
    "paths": {
      "@gateway/*": ["../gateway/src/*"]
    }
```
改为:
```json
    "paths": {
      "@gateway/*": ["../gateway/src/*"],
      "@routebox/llm-core": ["../../packages/llm-core/src/index.ts"]
    }
```

- [ ] **Step 2: proxy.ts import 核心定价**

`apps/cloud-gateway/src/routes/proxy.ts` 顶部 import 区加入:
```ts
import { pricingForModel, calculateCost as coreCalculateCost, type ModelPricing } from "@routebox/llm-core";
```
(`MODEL_PRICING` 数据保留在本文件,见下。)

- [ ] **Step 3: `pricingFor` / `calculateCost` 改为薄包装**

把(约 90-101 行):
```ts
export function pricingFor(model: string): { input: number; output: number } {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return val;
  }
  return { input: 1, output: 3 };
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = pricingFor(model);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
```
替换为:
```ts
export function pricingFor(model: string): ModelPricing {
  return pricingForModel(model, MODEL_PRICING, { fallback: { input: 1, output: 3 } });
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  return coreCalculateCost(model, inputTokens, outputTokens, MODEL_PRICING, { fallback: { input: 1, output: 3 } });
}
```
注意:`MODEL_PRICING` 的类型注解可保留为原样或改为 `Record<string, ModelPricing>`(等价)。不要改动表内任何数字。`getModelUserPrice`/`calculateUserCostCents`(其它计费函数)**不在本任务范围**,保持不变——它们内部调用 `pricingFor`,已自动走新实现且行为一致。

- [ ] **Step 4: key-pool.ts `ProviderTemplate` 改用核心类型**

`apps/cloud-gateway/src/lib/key-pool.ts` 顶部 import 区(`import { getCircuitBreaker } from "./circuit-breaker";` 之后)加:
```ts
import type { ProviderTemplate } from "@routebox/llm-core";
```
然后删除本地的接口定义(约 21-29 行):
```ts
interface ProviderTemplate {
  name: string;
  envKey: string;
  baseUrlEnvKey: string;
  defaultBaseUrl: string;
  prefixes: string[];
  format: "openai" | "anthropic";
  authHeader?: string;
}
```
(`PROVIDER_REGISTRY: ProviderTemplate[]` 现在引用 import 的类型;形状一致,运行时无变化。`CloudProviderConfig` 接口保留不动——它含 `instanceId`,是 cloud 专属。)

- [ ] **Step 5: 解析/打包验证**

Run:
```
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun build src/routes/proxy.ts --target=bun --outdir=/tmp/cl-proxy
bun build src/lib/key-pool.ts --target=bun --outdir=/tmp/cl-keypool
```
Expected: 两个都 bundle 成功。

- [ ] **Step 6: 行为回归测试**

Run(这些不需要 DATABASE_URL/Redis 的单测应直接跑;需要基础设施的集成测试若因环境跳过/报错属正常,只看与本改动相关的):
```
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway
bun test src/lib/key-pool.test.ts
bun test src/lib/metrics.test.ts
bun test src/lib/credits.test.ts
```
Expected: 各自 PASS(或仅因缺基础设施而非本改动失败——需逐一确认失败与本改动无关)。若有断言具体价格/成本的测试,数值必须与改动前一致。

- [ ] **Step 7: Commit**

```bash
find . -path ./node_modules -prune -o -name '._*' -delete 2>/dev/null
git add apps/cloud-gateway/tsconfig.json apps/cloud-gateway/src/routes/proxy.ts apps/cloud-gateway/src/lib/key-pool.ts
git commit -m "refactor(cloud): use @routebox/llm-core pricing/types (no behavior change)"
```

---

## Task 7: Final —— 全量验证 + 零行为变化确认 + 终审

- [ ] **Step 1: llm-core 包全测**

Run: `cd /Volumes/ROG_500GB/RouteBox/packages/llm-core && bun test`
Expected: 12 PASS。

- [ ] **Step 2: 两端入口能 bundle(解析闭环)**

Run:
```
cd /Volumes/ROG_500GB/RouteBox/apps/gateway && bun build src/index.ts --target=bun --outdir=/tmp/gw-entry
cd /Volumes/ROG_500GB/RouteBox/apps/cloud-gateway && bun build src/index.ts --target=bun --outdir=/tmp/cl-entry
```
Expected: 两个入口都成功 bundle(证明全图 `@routebox/llm-core` import 解析正常)。

- [ ] **Step 3: gateway 相关单测复跑(单文件)**

Run:
```
cd /Volumes/ROG_500GB/RouteBox/apps/gateway
bun test src/lib/providers.test.ts && bun test src/lib/router.test.ts && bun test src/routes/proxy.test.ts
```
Expected: 全 PASS。

- [ ] **Step 4: 零行为变化核对**

对照改动前后,确认:gateway `pricingForModel`/`calculateCost`/`resolveModelAlias` 与 cloud `pricingFor`/`calculateCost` 的输出在所有现有测试下数值一致;无 registry/pricing 数据被改动(`git diff 188274a..HEAD -- '*providers.ts' '*proxy.ts' '*key-pool.ts'` 中应只见 import/包装替换,无数字增删)。

- [ ] **Step 5: 派终审 reviewer**

对整个 Phase 1 commit 范围做一次代码评审,重点:(a) 核心定价函数确实化简为两端原行为;(b) 两端数据(registry/pricing 数字)未被改动;(c) 无新增 any/类型漏洞;(d) tsconfig 路径解析方案稳健。

---

## Self-Review notes(作者自检)

- **范围覆盖:** 用户确认的「只共享机制、数据留应用侧」全部落地——类型(Task 2)、定价(Task 3)、alias(Task 4)、两端接线(Task 5/6)。adapter/SSE/registry 统一显式排除,留 Phase 2。
- **零行为变化论证:** 核心 `pricingForModel` 判定顺序 = gateway 原顺序(free→override→exact→prefix→fallback);cloud 不传 opts 时退化为 exact→prefix→{1,3} = cloud 原行为。`calculateCost` 公式逐字一致。`resolveAlias` 对空表为恒等 = cloud 原行为。两端数据表与 registry **不改一个数字**。
- **类型一致性:** 核心导出名 `pricingForModel`/`calculateCost`/`resolveAlias`/`ProviderTemplate`/`ModelPricing`/`PricingOptions` 在 Task 2-4 定义,Task 5/6 import 使用一致;gateway 以 `as` 别名避免与本地包装重名。
- **磁盘/解析风险:** 采用 tsconfig paths(无需 pnpm install),Task 1 Step 6 设了解析冒烟门;若 Bun 不认 paths,已给出 workspace-dep 回退并要求 STOP 上报。
- **测试隔离:** 已知 gateway 多文件合跑问题,全程单文件验证;cloud 集成测试缺基础设施属环境因素,需区分。
