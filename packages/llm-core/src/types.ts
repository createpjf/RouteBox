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
