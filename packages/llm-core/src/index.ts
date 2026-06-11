// ---------------------------------------------------------------------------
// @routebox/llm-core — 两端共享的 LLM 机制(类型 / 定价算法 / alias)
// 数据(registry 列表、pricing 表)由各 app 注入,不在本包内。
// ---------------------------------------------------------------------------

export type { ProviderFormat, ProviderTemplate, ModelPricing } from "./types";
export { pricingForModel, calculateCost, type PricingOptions } from "./pricing";
export { resolveAlias } from "./aliases";
