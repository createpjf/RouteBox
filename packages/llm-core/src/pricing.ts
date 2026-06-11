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
