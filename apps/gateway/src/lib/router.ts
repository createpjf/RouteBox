// ---------------------------------------------------------------------------
// Routing strategy — pick the best provider+model for a request
// ---------------------------------------------------------------------------

import {
  providerForModel,
  providersForModel,
  providers,
  pricingForModel,
  MODEL_TIERS,
  type ProviderConfig,
} from "./providers";
import { getLocalProviderConfigs } from "./local-providers";
import { metrics } from "./metrics";
import { loadModelPreferences, loadDisabledModels, loadRoutingRules, type ModelPreferenceRow, type RoutingRuleRow } from "./db";
import { analyzeContent } from "./content-analyzer";

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

// ── Model toggles cache ─────────────────────────────────────────────────

let togglesCache: Set<string> | null = null;

export function refreshTogglesCache() {
  togglesCache = null;
}

function getDisabledSet(): Set<string> {
  if (togglesCache === null) {
    const rows = loadDisabledModels();
    togglesCache = new Set(rows.map((r) => compositeKey(r.provider_name, r.model_id)));
  }
  return togglesCache;
}

// ── Routing rules cache ─────────────────────────────────────────────────

let routingRulesCache: RoutingRuleRow[] | null = null;

export function refreshRoutingRulesCache() {
  routingRulesCache = null;
}

function getRoutingRules(): RoutingRuleRow[] {
  if (routingRulesCache === null) {
    routingRulesCache = loadRoutingRules();
  }
  return routingRulesCache;
}

function safeParseJson(s: string): Record<string, unknown> {
  try { return JSON.parse(s); }
  catch { return {}; }
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

/** Find a provider config by name (cloud or local) */
function findProvider(name: string): ProviderConfig | undefined {
  return providers.find((p) => p.name === name)
    ?? getLocalProviderConfigs().find((p) => p.name === name);
}

// ── Composite exclusion helpers ─────────────────────────────────────────────

/** Build composite key "provider:model" */
function compositeKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/** Check if a specific provider+model combination is excluded */
function isExcluded(excluded: Set<string>, providerName: string, model: string): boolean {
  return excluded.has(compositeKey(providerName, model));
}

/** Check if a provider is available for a model (not excluded and up) */
function isAvailable(excluded: Set<string>, providerName: string, model: string): boolean {
  return !isExcluded(excluded, providerName, model) && metrics.isProviderUp(providerName);
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
  messages?: { role: string; content: unknown }[],
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

  // ── Check routing rules ──
  const rules = getRoutingRules();

  // Model alias rules: if requestedModel matches a virtual name, reroute
  for (const rule of rules) {
    if (rule.match_type === "model_alias" && rule.match_value === requestedModel) {
      const targetProvider = rule.target_provider
        ? findProvider(rule.target_provider)
        : providerForModel(rule.target_model);
      if (targetProvider && metrics.isProviderUp(targetProvider.name)) {
        return { provider: targetProvider, model: rule.target_model, isFallback: false };
      }
      // If specified provider is down, try any provider for that model
      const anyProvider = providerForModel(rule.target_model);
      if (anyProvider && metrics.isProviderUp(anyProvider.name)) {
        return { provider: anyProvider, model: rule.target_model, isFallback: false };
      }
    }
  }

  // Collect excluded provider+model combinations (composite keys)
  const excluded = new Set<string>();
  for (const pref of prefs) {
    if (pref.action === "exclude" && matchesPattern(requestedModel, pref.model_pattern)) {
      excluded.add(compositeKey(pref.provider_name, pref.model_pattern));
    }
  }

  // Also build exact-model exclusions for the requested model
  // (e.g. pattern "kimi-k2-thinking" + provider "FLock.io" → exclude FLock.io:kimi-k2-thinking)
  for (const pref of prefs) {
    if (pref.action === "exclude") {
      // For wildcard patterns, expand to all tier models that match
      if (pref.model_pattern.endsWith("*") || pref.model_pattern === "*") {
        const allModels = Object.values(MODEL_TIERS).flat();
        for (const m of allModels) {
          if (matchesPattern(m, pref.model_pattern)) {
            excluded.add(compositeKey(pref.provider_name, m));
          }
        }
        // Also add for the requested model itself
        if (matchesPattern(requestedModel, pref.model_pattern)) {
          excluded.add(compositeKey(pref.provider_name, requestedModel));
        }
      } else {
        // Exact pattern — add composite for that exact model
        excluded.add(compositeKey(pref.provider_name, pref.model_pattern));
      }
    }
  }

  // Merge toggle-disabled models into exclusions
  const disabled = getDisabledSet();
  for (const key of disabled) {
    excluded.add(key);
  }

  // ── Content-aware routing rules (only for unknown/auto models) ──
  const isExplicitModel = !!providerForModel(requestedModel);
  if (messages && messages.length > 0 && !isExplicitModel) {
    const analysis = analyzeContent(messages);
    const contentMatchType = analysis.type === "code" ? "content_code"
      : analysis.type === "long_text" ? "content_long"
      : "content_general";

    for (const rule of rules) {
      if (rule.match_type === contentMatchType) {
        const config = safeParseJson(rule.match_value);
        if (rule.match_type === "content_code") {
          const minMarkers = (config.min_markers as number) ?? 3;
          if (analysis.codeMarkerCount < minMarkers && !analysis.hasCodeBlocks) continue;
        } else if (rule.match_type === "content_long") {
          const minChars = (config.min_chars as number) ?? 8000;
          if (analysis.totalChars < minChars) continue;
        }
        // content_general always matches as a fallback
        const targetProvider = rule.target_provider
          ? findProvider(rule.target_provider)
          : providerForModel(rule.target_model);
        if (targetProvider && metrics.isProviderUp(targetProvider.name)) {
          return { provider: targetProvider, model: rule.target_model, isFallback: false };
        }
        const anyProvider = providerForModel(rule.target_model);
        if (anyProvider && metrics.isProviderUp(anyProvider.name)) {
          return { provider: anyProvider, model: rule.target_model, isFallback: false };
        }
      }
    }
  }

  // ── Normal strategy routing ──
  const canonical = providerForModel(requestedModel);

  // Check if canonical is available (not excluded for this model AND up)
  const canonicalOk = canonical
    && !isExcluded(excluded, canonical.name, requestedModel)
    && metrics.isProviderUp(canonical.name);

  // ── Wildcard: unknown model → route to best available ──
  if (!canonical) {
    return wildcardRoute(requestedModel, strategy, excluded);
  }

  // ── When canonical is excluded, try other providers for the SAME model first ──
  if (!canonicalOk) {
    const altProviders = providersForModel(requestedModel);
    for (const alt of altProviders) {
      if (alt.name !== canonical?.name && isAvailable(excluded, alt.name, requestedModel)) {
        return { provider: alt, model: requestedModel, isFallback: false };
      }
    }
  }

  if (strategy === "quality_first") {
    if (canonicalOk) {
      return { provider: canonical!, model: requestedModel, isFallback: false };
    }
    return fallbackRoute(requestedModel, excluded);
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
  return fallbackRoute(requestedModel, excluded);
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
    // Check ALL providers for this model
    const candidateProviders = providersForModel(model);
    for (const p of candidateProviders) {
      if (isExcluded(excluded, p.name, model) || !metrics.isProviderUp(p.name)) continue;
      const pricing = pricingForModel(model, p.name);
      const avgCost = (pricing.input + pricing.output) / 2;
      if (avgCost < bestCost || (avgCost === bestCost && p.name === "FLock.io")) {
        bestCost = avgCost;
        best = { provider: p, model, isFallback: model !== requestedModel };
      }
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
    const candidateProviders = providersForModel(model);
    for (const p of candidateProviders) {
      if (isExcluded(excluded, p.name, model) || !metrics.isProviderUp(p.name)) continue;
      const lat = metrics.getProviderLatency(p.name);
      if (lat < bestLatency || (lat === bestLatency && p.name === "FLock.io")) {
        bestLatency = lat;
        best = { provider: p, model, isFallback: model !== requestedModel };
      }
    }
  }

  return best;
}

/** Route unknown/wildcard models to the best available provider */
function wildcardRoute(
  requestedModel: string,
  strategy: string,
  excluded: Set<string>,
): RouteResult | null {
  if (strategy === "cost_first") {
    const allModels = Object.values(MODEL_TIERS).flat();
    let best: RouteResult | null = null;
    let bestCost = Infinity;
    for (const model of allModels) {
      const candidateProviders = providersForModel(model);
      for (const p of candidateProviders) {
        if (isExcluded(excluded, p.name, model) || !metrics.isProviderUp(p.name)) continue;
        const pricing = pricingForModel(model, p.name);
        const avgCost = (pricing.input + pricing.output) / 2;
        if (avgCost < bestCost) {
          bestCost = avgCost;
          best = { provider: p, model, isFallback: true };
        }
      }
    }
    return best;
  }

  if (strategy === "speed_first") {
    const allModels = Object.values(MODEL_TIERS).flat();
    let best: RouteResult | null = null;
    let bestLatency = Infinity;
    for (const model of allModels) {
      const candidateProviders = providersForModel(model);
      for (const p of candidateProviders) {
        if (isExcluded(excluded, p.name, model) || !metrics.isProviderUp(p.name)) continue;
        const lat = metrics.getProviderLatency(p.name);
        if (lat < bestLatency) {
          bestLatency = lat;
          best = { provider: p, model, isFallback: true };
        }
      }
    }
    return best;
  }

  // quality_first / smart_auto — first available from flagship, then fast
  for (const tierModels of Object.values(MODEL_TIERS)) {
    for (const model of tierModels) {
      const candidateProviders = providersForModel(model);
      for (const p of candidateProviders) {
        if (isExcluded(excluded, p.name, model) || !metrics.isProviderUp(p.name)) continue;
        return { provider: p, model, isFallback: true };
      }
    }
  }

  return null;
}

function fallbackRoute(
  requestedModel: string,
  excluded: Set<string>,
): RouteResult | null {
  const tier = tierFor(requestedModel);
  if (!tier) return null;

  // Prefer FLock.io as the first fallback when available
  let firstNonFlock: RouteResult | null = null;
  for (const model of tier) {
    const candidateProviders = providersForModel(model);
    for (const p of candidateProviders) {
      if (isExcluded(excluded, p.name, model) || !metrics.isProviderUp(p.name)) continue;
      if (p.name === "FLock.io") {
        return { provider: p, model, isFallback: true };
      }
      if (!firstNonFlock) {
        firstNonFlock = { provider: p, model, isFallback: true };
      }
    }
  }
  return firstNonFlock;
}
