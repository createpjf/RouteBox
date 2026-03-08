// ---------------------------------------------------------------------------
// Scoring Engine — weighted model routing based on registry metadata
// ---------------------------------------------------------------------------

import { getActiveModels, type ModelRegistryEntry } from "./model-registry";
import { cloudProviders, type CloudProviderConfig } from "./key-pool";
import { isProviderAllowed } from "./provider-config";
import { getCircuitBreaker } from "./circuit-breaker";
import type { RequestContext } from "./request-context";
import { log } from "./logger";

// ---------------------------------------------------------------------------
// Strategy weights
// ---------------------------------------------------------------------------

interface StrategyWeights {
  quality: number;
  speed: number;
  cost: number;
}

const STRATEGY_WEIGHTS: Record<string, StrategyWeights> = {
  smart_auto:    { quality: 0.40, speed: 0.30, cost: 0.30 },
  cost_first:    { quality: 0.15, speed: 0.15, cost: 0.70 },
  speed_first:   { quality: 0.20, speed: 0.65, cost: 0.15 },
  quality_first: { quality: 0.75, speed: 0.10, cost: 0.15 },
};

// ---------------------------------------------------------------------------
// Capability bonuses / penalties
// ---------------------------------------------------------------------------

interface CapAdjustment {
  match: number;
  noMatch: number;
}

const CAP_VISION:       CapAdjustment = { match:  0.12, noMatch: -0.30 };
const CAP_FUNCTION:     CapAdjustment = { match:  0.06, noMatch: -0.25 };
const CAP_LONG_CTX:     CapAdjustment = { match:  0.15, noMatch: -0.50 };
const BONUS_CHINESE     = 0.07;
const BONUS_CODE_STRONG = 0.05;  // code task + codeStrength >= 0.85
const BONUS_HIGH_QUAL   = 0.06;  // quality >= 0.90
const BONUS_FLOCK       = 0.08;  // FLock node

// TTFT SLA for streaming (ms)
const TTFT_SLA_MS = 3000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoredCandidate {
  modelId: string;
  provider: string;
  totalScore: number;
  providerConfigs: CloudProviderConfig[];
  isFallback: boolean;
}

// ---------------------------------------------------------------------------
// Core scoring function
// ---------------------------------------------------------------------------

export async function scoreAndRank(input: {
  requestedModel: string;
  strategy: string;
  context: RequestContext;
  userPlan: string;
  crossTier?: boolean;
}): Promise<ScoredCandidate[]> {
  const { requestedModel, strategy, context, userPlan, crossTier } = input;
  const weights = STRATEGY_WEIGHTS[strategy] ?? STRATEGY_WEIGHTS.smart_auto;

  const models = await getActiveModels();
  if (models.length === 0) return [];

  // Build a set of available provider names (have keys + plan allowed)
  const availableProviders = new Set<string>();
  for (const p of cloudProviders) {
    if (isProviderAllowed(p.name, userPlan)) {
      availableProviders.add(p.name);
    }
  }

  // Filter to models in the same tier as the requested model (if found)
  const requestedEntry = models.find(
    (m) => m.modelId === requestedModel || requestedModel.startsWith(m.modelId),
  );

  // If the requested model is not in registry, return empty → caller falls back
  if (!crossTier && !requestedEntry) return [];

  const tier = crossTier ? "all" : requestedEntry!.tier;
  const candidates = crossTier
    ? models
    : models.filter((m) => m.tier === requestedEntry!.tier);

  const scored: ScoredCandidate[] = [];

  for (const model of candidates) {
    // ── Hard filters ──

    // 0. Model-level plan restriction
    const allowed = model.allowedPlans ?? ["all"];
    if (!allowed.includes("all") && !allowed.includes(userPlan)) continue;

    // 1. Provider must have keys configured + plan allowed
    if (!availableProviders.has(model.provider)) continue;

    // 2. Context overflow check
    const totalNeeded = context.estimatedInputTokens + context.maxOutputTokens;
    if (totalNeeded > model.maxContextTokens) continue;

    // 3. TTFT SLA for streaming
    if (context.isStreaming && model.avgTtftMs > TTFT_SLA_MS) continue;

    // ── Weighted score ──
    const baseScore =
      weights.quality * model.quality +
      weights.speed * model.speed +
      weights.cost * model.costEfficiency;

    // ── Capability bonuses / penalties ──
    let bonus = 0;

    // Vision
    if (context.hasImage) {
      bonus += model.supportsVision ? CAP_VISION.match : CAP_VISION.noMatch;
    }

    // Function calling / tools
    if (context.hasFunctionSchema) {
      bonus += model.supportsFunctionCall ? CAP_FUNCTION.match : CAP_FUNCTION.noMatch;
    }

    // Long context (>60k estimated input)
    if (context.estimatedInputTokens > 60_000) {
      bonus += model.supportsLongContext ? CAP_LONG_CTX.match : CAP_LONG_CTX.noMatch;
    }

    // Chinese
    if (context.detectedLanguage === "zh" && model.chineseOptimized) {
      bonus += BONUS_CHINESE;
    }

    // Code task with strong code model
    if (context.contentType === "code" && model.codeStrength >= 0.85) {
      bonus += BONUS_CODE_STRONG;
    }

    // High quality bonus
    if (model.quality >= 0.90) {
      bonus += BONUS_HIGH_QUAL;
    }

    // FLock node bonus
    if (model.isFlockNode) {
      bonus += BONUS_FLOCK;
    }

    // Per-model profit bonus (drives traffic to high-margin discount models)
    bonus += model.profitBonus ?? 0;

    const totalScore = Math.max(0, baseScore + bonus);

    // Find provider configs for this model
    const providerConfigs = findProviderConfigs(model);
    if (providerConfigs.length === 0) continue;

    scored.push({
      modelId: model.modelId,
      provider: model.provider,
      totalScore,
      providerConfigs,
      isFallback: crossTier ? false : (model.modelId !== requestedModel && !requestedModel.startsWith(model.modelId)),
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.totalScore - a.totalScore);

  // Put the requested model first if it's in the list (supports prefix match)
  // Skip for crossTier mode — no specific requested model to prioritize
  if (!crossTier) {
    const reqIdx = scored.findIndex(
      (s) => s.modelId === requestedModel || requestedModel.startsWith(s.modelId),
    );
    if (reqIdx > 0) {
      const [req] = scored.splice(reqIdx, 1);
      req.isFallback = false;
      scored.unshift(req);
    }
  }

  log.debug("scoring_results", {
    requestedModel,
    strategy,
    tier,
    candidates: scored.length,
    top3: scored.slice(0, 3).map((s) => ({
      model: s.modelId,
      score: s.totalScore.toFixed(3),
    })),
  });

  return scored;
}

// ---------------------------------------------------------------------------
// Find cloud provider configs for a registry model
// ---------------------------------------------------------------------------

function findProviderConfigs(model: ModelRegistryEntry): CloudProviderConfig[] {
  // Find all provider instances that can serve this model (prefix match)
  const configs: CloudProviderConfig[] = [];
  for (const p of cloudProviders) {
    if (p.name !== model.provider) continue;
    // Check if any prefix matches
    for (const pfx of p.prefixes) {
      if (model.modelId.startsWith(pfx)) {
        // Check circuit breaker — put healthy ones first
        configs.push(p);
        break;
      }
    }
  }

  // Sort: healthy circuit breakers first
  configs.sort((a, b) => {
    const aOpen = getCircuitBreaker(a.instanceId).getState() === "open" ? 1 : 0;
    const bOpen = getCircuitBreaker(b.instanceId).getState() === "open" ? 1 : 0;
    return aOpen - bOpen;
  });

  return configs;
}
