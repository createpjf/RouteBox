// ---------------------------------------------------------------------------
// Model alias 解析 —— 别名表由调用方注入(gateway 有表,cloud 传空表)
// ---------------------------------------------------------------------------

/** 把用户给的模型名按别名表解析为规范 ID;无命中则原样返回。 */
export function resolveAlias(model: string, aliases: Record<string, string>): string {
  return aliases[model] ?? model;
}
