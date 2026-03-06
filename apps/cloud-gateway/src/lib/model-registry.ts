// ---------------------------------------------------------------------------
// Model Registry — DB-backed model metadata for scoring-engine routing
// ---------------------------------------------------------------------------

import { sql } from "./db-cloud";
import { log } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelRegistryEntry {
  id: string;
  modelId: string;
  displayName: string;
  provider: string;
  status: "active" | "beta" | "deprecated";
  tier: "flagship" | "fast";

  quality: number;
  speed: number;
  costEfficiency: number;
  codeStrength: number;

  supportsVision: boolean;
  supportsFunctionCall: boolean;
  supportsLongContext: boolean;
  chineseOptimized: boolean;

  maxContextTokens: number;
  avgTtftMs: number;

  priceInput: number;
  priceOutput: number;

  isFlockNode: boolean;

  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Row → Entry mapping
// ---------------------------------------------------------------------------

function rowToEntry(r: Record<string, unknown>): ModelRegistryEntry {
  return {
    id: r.id as string,
    modelId: r.model_id as string,
    displayName: r.display_name as string,
    provider: r.provider as string,
    status: r.status as "active" | "beta" | "deprecated",
    tier: r.tier as "flagship" | "fast",
    quality: r.quality as number,
    speed: r.speed as number,
    costEfficiency: r.cost_efficiency as number,
    codeStrength: r.code_strength as number,
    supportsVision: r.supports_vision as boolean,
    supportsFunctionCall: r.supports_function_call as boolean,
    supportsLongContext: r.supports_long_context as boolean,
    chineseOptimized: r.chinese_optimized as boolean,
    maxContextTokens: r.max_context_tokens as number,
    avgTtftMs: r.avg_ttft_ms as number,
    priceInput: r.price_input as number,
    priceOutput: r.price_output as number,
    isFlockNode: r.is_flock_node as boolean,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export async function listModels(): Promise<ModelRegistryEntry[]> {
  const rows = await sql`
    SELECT * FROM model_registry ORDER BY tier, provider, model_id
  `;
  return rows.map(rowToEntry);
}

export async function getModel(id: string): Promise<ModelRegistryEntry | null> {
  const [row] = await sql`SELECT * FROM model_registry WHERE id = ${id}`;
  return row ? rowToEntry(row) : null;
}

export async function createModel(data: {
  modelId: string;
  displayName: string;
  provider: string;
  status?: string;
  tier?: string;
  quality?: number;
  speed?: number;
  costEfficiency?: number;
  codeStrength?: number;
  supportsVision?: boolean;
  supportsFunctionCall?: boolean;
  supportsLongContext?: boolean;
  chineseOptimized?: boolean;
  maxContextTokens?: number;
  avgTtftMs?: number;
  priceInput?: number;
  priceOutput?: number;
  isFlockNode?: boolean;
}): Promise<ModelRegistryEntry> {
  const [row] = await sql`
    INSERT INTO model_registry (
      model_id, display_name, provider, status, tier,
      quality, speed, cost_efficiency, code_strength,
      supports_vision, supports_function_call, supports_long_context, chinese_optimized,
      max_context_tokens, avg_ttft_ms, price_input, price_output, is_flock_node
    ) VALUES (
      ${data.modelId},
      ${data.displayName},
      ${data.provider},
      ${data.status ?? "active"},
      ${data.tier ?? "fast"},
      ${data.quality ?? 0.7},
      ${data.speed ?? 0.7},
      ${data.costEfficiency ?? 0.7},
      ${data.codeStrength ?? 0.7},
      ${data.supportsVision ?? false},
      ${data.supportsFunctionCall ?? true},
      ${data.supportsLongContext ?? false},
      ${data.chineseOptimized ?? false},
      ${data.maxContextTokens ?? 128000},
      ${data.avgTtftMs ?? 500},
      ${data.priceInput ?? 1.0},
      ${data.priceOutput ?? 3.0},
      ${data.isFlockNode ?? false}
    )
    RETURNING *
  `;
  return rowToEntry(row);
}

export async function updateModel(
  id: string,
  updates: Partial<{
    displayName: string;
    provider: string;
    status: string;
    tier: string;
    quality: number;
    speed: number;
    costEfficiency: number;
    codeStrength: number;
    supportsVision: boolean;
    supportsFunctionCall: boolean;
    supportsLongContext: boolean;
    chineseOptimized: boolean;
    maxContextTokens: number;
    avgTtftMs: number;
    priceInput: number;
    priceOutput: number;
    isFlockNode: boolean;
  }>,
): Promise<ModelRegistryEntry | null> {
  // Map camelCase keys to snake_case DB columns
  const fieldMap: Record<string, string> = {
    displayName: "display_name",
    provider: "provider",
    status: "status",
    tier: "tier",
    quality: "quality",
    speed: "speed",
    costEfficiency: "cost_efficiency",
    codeStrength: "code_strength",
    supportsVision: "supports_vision",
    supportsFunctionCall: "supports_function_call",
    supportsLongContext: "supports_long_context",
    chineseOptimized: "chinese_optimized",
    maxContextTokens: "max_context_tokens",
    avgTtftMs: "avg_ttft_ms",
    priceInput: "price_input",
    priceOutput: "price_output",
    isFlockNode: "is_flock_node",
  };

  // Build a single atomic UPDATE with all changed fields
  const setObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    const col = fieldMap[key];
    if (!col || value === undefined) continue;
    setObj[col] = value;
  }

  if (Object.keys(setObj).length === 0) return getModel(id);

  setObj.updated_at = sql`now()`;

  const [row] = await sql`
    UPDATE model_registry SET ${sql(setObj)}
    WHERE id = ${id} RETURNING *
  `;
  return row ? rowToEntry(row) : null;
}

export async function deleteModel(id: string): Promise<boolean> {
  const result = await sql`DELETE FROM model_registry WHERE id = ${id}`;
  return result.count > 0;
}

// ---------------------------------------------------------------------------
// Cache for scoring engine (hot path)
// ---------------------------------------------------------------------------

let registryCache: ModelRegistryEntry[] | null = null;

export async function getActiveModels(): Promise<ModelRegistryEntry[]> {
  if (registryCache) return registryCache;

  const rows = await sql`
    SELECT * FROM model_registry
    WHERE status != 'deprecated'
    ORDER BY tier, provider, model_id
  `;
  registryCache = rows.map(rowToEntry);
  log.info("model_registry_loaded", { count: registryCache.length });
  return registryCache;
}

export function reloadRegistry(): void {
  registryCache = null;
}

/** Find a registry entry by model ID (supports prefix matching) */
export async function getRegistryEntry(
  modelId: string,
): Promise<ModelRegistryEntry | undefined> {
  const models = await getActiveModels();

  // Exact match first
  const exact = models.find((m) => m.modelId === modelId);
  if (exact) return exact;

  // Prefix match (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
  let best: ModelRegistryEntry | undefined;
  let bestLen = 0;
  for (const m of models) {
    if (modelId.startsWith(m.modelId) && m.modelId.length > bestLen) {
      best = m;
      bestLen = m.modelId.length;
    }
  }
  return best;
}
