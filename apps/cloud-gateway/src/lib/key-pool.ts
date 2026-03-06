// ---------------------------------------------------------------------------
// Pooled API Keys — cloud gateway uses env-var keys for all providers
// Supports multi-key: OPENAI_API_KEY, OPENAI_API_KEY_2, OPENAI_API_KEY_3, ...
// ---------------------------------------------------------------------------

import { log } from "./logger";
import { getCircuitBreaker } from "./circuit-breaker";

export interface CloudProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  prefixes: string[];
  format: "openai" | "anthropic";
  /** Custom auth header (default: "Authorization" with "Bearer " prefix) */
  authHeader?: string;
  /** Unique instance ID for multi-key support (e.g., "OpenAI:0") */
  instanceId: string;
}

interface ProviderTemplate {
  name: string;
  envKey: string;
  baseUrlEnvKey: string;
  defaultBaseUrl: string;
  prefixes: string[];
  format: "openai" | "anthropic";
  authHeader?: string;
}

export const PROVIDER_REGISTRY: ProviderTemplate[] = [
  {
    name: "OpenAI",
    envKey: "OPENAI_API_KEY",
    baseUrlEnvKey: "OPENAI_BASE_URL",
    defaultBaseUrl: "https://api.openai.com/v1",
    prefixes: ["gpt-", "o1", "o3", "o4", "chatgpt-"],
    format: "openai",
  },
  {
    name: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    baseUrlEnvKey: "ANTHROPIC_BASE_URL",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    prefixes: ["claude-"],
    format: "anthropic",
  },
  {
    name: "Google",
    envKey: "GOOGLE_API_KEY",
    baseUrlEnvKey: "GOOGLE_BASE_URL",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    prefixes: ["gemini-"],
    format: "openai",
  },
  {
    name: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    baseUrlEnvKey: "DEEPSEEK_BASE_URL",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    prefixes: ["deepseek-"],
    format: "openai",
  },
  {
    name: "MiniMax",
    envKey: "MINIMAX_API_KEY",
    baseUrlEnvKey: "MINIMAX_BASE_URL",
    defaultBaseUrl: "https://api.minimax.io/v1",
    prefixes: ["MiniMax-"],
    format: "openai",
  },
  {
    name: "Kimi",
    envKey: "KIMI_API_KEY",
    baseUrlEnvKey: "KIMI_BASE_URL",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    prefixes: ["kimi-", "moonshot-"],
    format: "openai",
  },
  {
    name: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    baseUrlEnvKey: "OPENROUTER_BASE_URL",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    prefixes: ["openrouter/"],
    format: "openai",
  },
  {
    name: "FLock.io",
    envKey: "FLOCK_API_KEY",
    baseUrlEnvKey: "FLOCK_BASE_URL",
    defaultBaseUrl: "https://api.flock.io/v1",
    prefixes: ["qwen3-", "deepseek-v3"],
    format: "openai",
    authHeader: "x-litellm-api-key",
  },
  {
    name: "GLM",
    envKey: "GLM_API_KEY",
    baseUrlEnvKey: "GLM_BASE_URL",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    prefixes: ["glm-"],
    format: "openai",
  },
];

function env(key: string): string {
  return process.env[key] ?? "";
}

/** Scan environment for all keys matching a pattern: KEY, KEY_2, KEY_3, ... */
function scanEnvKeys(baseEnvKey: string): string[] {
  const keys: string[] = [];
  const primary = env(baseEnvKey);
  if (primary) keys.push(primary);
  for (let i = 2; i <= 10; i++) {
    const val = env(`${baseEnvKey}_${i}`);
    if (val) keys.push(val);
  }
  return keys;
}

/** Build cloud provider configs from env vars (supports multi-key) */
export function buildCloudProviders(): CloudProviderConfig[] {
  const list: CloudProviderConfig[] = [];
  for (const tmpl of PROVIDER_REGISTRY) {
    const apiKeys = scanEnvKeys(tmpl.envKey);
    if (apiKeys.length === 0) continue;

    const baseUrl = env(tmpl.baseUrlEnvKey) || tmpl.defaultBaseUrl;

    for (let i = 0; i < apiKeys.length; i++) {
      list.push({
        name: tmpl.name,
        baseUrl,
        apiKey: apiKeys[i],
        prefixes: tmpl.prefixes,
        format: tmpl.format,
        authHeader: tmpl.authHeader,
        instanceId: `${tmpl.name}:${i}`,
      });
    }
  }
  return list;
}

// Module-level providers (built once at startup)
export let cloudProviders: CloudProviderConfig[] = [];

export function initCloudProviders(dbKeys?: CloudProviderConfig[]) {
  const envProviders = buildCloudProviders();
  cloudProviders = dbKeys && dbKeys.length > 0
    ? [...envProviders, ...dbKeys]
    : envProviders;

  const summary: Record<string, number> = {};
  for (const p of cloudProviders) {
    summary[p.name] = (summary[p.name] ?? 0) + 1;
  }
  log.info("providers_initialized", {
    count: cloudProviders.length,
    providers: summary,
  });
}

// Round-robin counters per provider name
const rrCounters = new Map<string, number>();

/**
 * Find ALL provider instances for a model (longest prefix match),
 * ordered by round-robin rotation, with OPEN circuit breakers sorted last.
 */
export function cloudProvidersForModel(model: string): CloudProviderConfig[] {
  // Step 1: Find best prefix match
  let bestPrefixLen = 0;
  let bestProviderName = "";
  for (const p of cloudProviders) {
    for (const pfx of p.prefixes) {
      if (model.startsWith(pfx) && pfx.length > bestPrefixLen) {
        bestPrefixLen = pfx.length;
        bestProviderName = p.name;
      }
    }
  }
  if (!bestProviderName) return [];

  // Step 2: Collect all instances for this provider name
  const instances = cloudProviders.filter((p) => p.name === bestProviderName);

  // Step 3: Round-robin — rotate starting position
  const counter = rrCounters.get(bestProviderName) ?? 0;
  rrCounters.set(bestProviderName, counter + 1);
  const len = instances.length;
  const ordered: CloudProviderConfig[] = [];
  for (let i = 0; i < len; i++) {
    ordered.push(instances[(counter + i) % len]!);
  }

  // Step 4: Sort by circuit breaker availability (available first, open last)
  ordered.sort((a, b) => {
    const aOpen =
      getCircuitBreaker(a.instanceId).getState() === "open" ? 1 : 0;
    const bOpen =
      getCircuitBreaker(b.instanceId).getState() === "open" ? 1 : 0;
    return aOpen - bOpen;
  });

  return ordered;
}

/** Backward-compatible: returns first available provider for a model */
export function cloudProviderForModel(
  model: string,
): CloudProviderConfig | undefined {
  const providers = cloudProvidersForModel(model);
  return providers[0];
}
