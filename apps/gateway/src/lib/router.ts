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
import { loadModelPreferences, type ModelPreferenceRow } from "./db";

export interface RouteResult {
  provider: ProviderConfig;
  model: string;
  /** Was this a fallback from the originally-requested model? */
  isFallback: boolean;
}

// ── Model preferences cache ─────────────────────────────────────────────────

let preferencesCache: ModelPreferenceRow[] | null = null;

export function refreshPreferencesCache() {
  preferencesCache = null;
}

function getPreferences(): ModelPreferenceRow[] {
  if (preferencesCache === null) {
    preferencesCache = loadModelPreferences();
  }
  return preferencesCache;
}

/** Check if a model matches a pattern (supports trailing * wildcard) */
function matchesPattern(model: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    return model.startsWith(pattern.slice(0, -1));
  }
  return model === pattern;
}

/** Find a provider config by name */
function findProvider(name: string): ProviderConfig | undefined {
  return providers.find((p) => p.name === name);
}

// ── Core routing ────────────────────────────────────────────────────────────

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
  // ── Check model preferences first ──
  const prefs = getPreferences();

  // Check for pins (highest priority)
  for (const pref of prefs) {
    if (pref.action === "pin" && matchesPattern(requestedModel, pref.model_pattern)) {
      const pinned = findProvider(pref.provider_name);
      if (pinned && metrics.isProviderUp(pinned.name)) {
        return { provider: pinned, model: requestedModel, isFallback: false };
      }
      // Pinned provider is down — fall through to normal strategy
      break;
    }
  }

  // Collect excluded providers
  const excluded = new Set<string>();
  for (const pref of prefs) {
    if (pref.action === "exclude" && matchesPattern(requestedModel, pref.model_pattern)) {
      excluded.add(pref.provider_name);
    }
  }

  // ── Normal strategy routing ──
  const canonical = providerForModel(requestedModel);
  const canonicalOk = canonical && !excluded.has(canonical.name) && metrics.isProviderUp(canonical.name);

  if (strategy === "quality_first") {
    if (canonicalOk) {
      return { provider: canonical!, model: requestedModel, isFallback: false };
    }
    return fallbackRoute(requestedModel, canonical?.name, excluded);
  }

  if (strategy === "cost_first") {
    return costFirstRoute(requestedModel, canonicalOk ? canonical : undefined, excluded);
  }

  if (strategy === "speed_first") {
    return speedFirstRoute(requestedModel, canonicalOk ? canonical : undefined, excluded);
  }

  // smart_auto: try canonical first, fall back intelligently
  if (canonicalOk) {
    return { provider: canonical!, model: requestedModel, isFallback: false };
  }
  return fallbackRoute(requestedModel, canonical?.name, excluded);
}

function costFirstRoute(
  requestedModel: string,
  canonical: ProviderConfig | undefined,
  excluded: Set<string>,
): RouteResult | null {
  const tier = tierFor(requestedModel);
  if (!tier) {
    if (canonical && metrics.isProviderUp(canonical.name)) {
      return { provider: canonical, model: requestedModel, isFallback: false };
    }
    return null;
  }

  let best: RouteResult | null = null;
  let bestCost = Infinity;

  for (const model of tier) {
    const p = providerForModel(model);
    if (!p || excluded.has(p.name) || !metrics.isProviderUp(p.name)) continue;
    const pricing = pricingForModel(model);
    const avgCost = (pricing.input + pricing.output) / 2;
    if (avgCost < bestCost || (avgCost === bestCost && p.name === "FLock.io")) {
      bestCost = avgCost;
      best = { provider: p, model, isFallback: model !== requestedModel };
    }
  }

  return best;
}

function speedFirstRoute(
  requestedModel: string,
  canonical: ProviderConfig | undefined,
  excluded: Set<string>,
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
    if (!p || excluded.has(p.name) || !metrics.isProviderUp(p.name)) continue;
    const lat = metrics.getProviderLatency(p.name);
    if (lat < bestLatency || (lat === bestLatency && p.name === "FLock.io")) {
      bestLatency = lat;
      best = { provider: p, model, isFallback: model !== requestedModel };
    }
  }

  return best;
}

function fallbackRoute(
  requestedModel: string,
  excludeProvider?: string,
  excluded?: Set<string>,
): RouteResult | null {
  const tier = tierFor(requestedModel);
  if (!tier) return null;

  // Prefer FLock.io as the first fallback when available
  let firstNonFlock: RouteResult | null = null;
  for (const model of tier) {
    const p = providerForModel(model);
    if (!p || p.name === excludeProvider || !metrics.isProviderUp(p.name)) continue;
    if (excluded?.has(p.name)) continue;
    if (p.name === "FLock.io") {
      return { provider: p, model, isFallback: true };
    }
    if (!firstNonFlock) {
      firstNonFlock = { provider: p, model, isFallback: true };
    }
  }
  return firstNonFlock;
}
