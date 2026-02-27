// ---------------------------------------------------------------------------
// Routing strategy — pick the best provider+model for a request
// ---------------------------------------------------------------------------

import {
  providerForModel,
  providers,
  pricingForModel,
  MODEL_TIERS,
  type ProviderConfig,
} from "./providers";
import { metrics } from "./metrics";

export interface RouteResult {
  provider: ProviderConfig;
  model: string;
  /** Was this a fallback from the originally-requested model? */
  isFallback: boolean;
}

/** Find which tier a model belongs to, if any */
function tierFor(model: string): string[] | undefined {
  for (const models of Object.values(MODEL_TIERS)) {
    if (models.some((m) => model.startsWith(m))) return models;
  }
  return undefined;
}

/**
 * Select a provider + model for the given request model and strategy.
 * Returns null if no provider is available.
 */
export function selectRoute(
  requestedModel: string,
  strategy: string,
): RouteResult | null {
  // Direct / quality-first: use the canonical provider if available
  const canonical = providerForModel(requestedModel);

  if (strategy === "quality_first") {
    if (canonical && metrics.isProviderUp(canonical.name)) {
      return { provider: canonical, model: requestedModel, isFallback: false };
    }
    // Fallback to any provider that can serve an equivalent
    return fallbackRoute(requestedModel, canonical?.name);
  }

  if (strategy === "cost_first") {
    return costFirstRoute(requestedModel, canonical);
  }

  if (strategy === "speed_first") {
    return speedFirstRoute(requestedModel, canonical);
  }

  // smart_auto: try canonical first, fall back intelligently
  if (canonical && metrics.isProviderUp(canonical.name)) {
    return { provider: canonical, model: requestedModel, isFallback: false };
  }
  return fallbackRoute(requestedModel, canonical?.name);
}

function costFirstRoute(
  requestedModel: string,
  canonical: ProviderConfig | undefined,
): RouteResult | null {
  const tier = tierFor(requestedModel);
  if (!tier) {
    // No tier — use canonical
    if (canonical && metrics.isProviderUp(canonical.name)) {
      return { provider: canonical, model: requestedModel, isFallback: false };
    }
    return null;
  }

  // Find cheapest model in this tier that has an available provider
  let best: RouteResult | null = null;
  let bestCost = Infinity;

  for (const model of tier) {
    const p = providerForModel(model);
    if (!p || !metrics.isProviderUp(p.name)) continue;
    const pricing = pricingForModel(model);
    const avgCost = (pricing.input + pricing.output) / 2;
    if (avgCost < bestCost) {
      bestCost = avgCost;
      best = { provider: p, model, isFallback: model !== requestedModel };
    }
  }

  return best;
}

function speedFirstRoute(
  requestedModel: string,
  canonical: ProviderConfig | undefined,
): RouteResult | null {
  const tier = tierFor(requestedModel);
  if (!tier) {
    if (canonical && metrics.isProviderUp(canonical.name)) {
      return { provider: canonical, model: requestedModel, isFallback: false };
    }
    return null;
  }

  let best: RouteResult | null = null;
  let bestLatency = Infinity;

  for (const model of tier) {
    const p = providerForModel(model);
    if (!p || !metrics.isProviderUp(p.name)) continue;
    const lat = metrics.getProviderLatency(p.name);
    if (lat < bestLatency) {
      bestLatency = lat;
      best = { provider: p, model, isFallback: model !== requestedModel };
    }
  }

  return best;
}

function fallbackRoute(
  requestedModel: string,
  excludeProvider?: string,
): RouteResult | null {
  const tier = tierFor(requestedModel);
  if (!tier) return null;

  for (const model of tier) {
    const p = providerForModel(model);
    if (!p || p.name === excludeProvider || !metrics.isProviderUp(p.name)) continue;
    return { provider: p, model, isFallback: true };
  }
  return null;
}
