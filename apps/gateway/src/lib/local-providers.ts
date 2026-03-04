// ---------------------------------------------------------------------------
// Local provider discovery — Ollama, LM Studio auto-detection + polling
// ---------------------------------------------------------------------------

import type { ProviderConfig } from "./providers";
import { loadSetting, saveSetting } from "./db";

export interface LocalProviderState {
  name: string;
  baseUrl: string;
  isOnline: boolean;
  models: string[];
  lastChecked: number;
}

const LOCAL_PROVIDER_DEFAULTS: { name: string; defaultBaseUrl: string }[] = [
  { name: "Ollama", defaultBaseUrl: "http://localhost:11434/v1" },
  { name: "LM Studio", defaultBaseUrl: "http://localhost:1234/v1" },
];

// Module-level state
export let localProviders: LocalProviderState[] = [];

let pollingHandle: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Init — load saved URLs or use defaults
// ---------------------------------------------------------------------------

export function initLocalProviders() {
  localProviders = LOCAL_PROVIDER_DEFAULTS.map((d) => {
    const savedUrl = loadSetting(`localProvider:${d.name}:baseUrl`);
    return {
      name: d.name,
      baseUrl: savedUrl || d.defaultBaseUrl,
      isOnline: false,
      models: [],
      lastChecked: 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Probe — fetch GET /models from a local server
// ---------------------------------------------------------------------------

export async function probeLocalProvider(state: LocalProviderState): Promise<void> {
  try {
    const url = `${state.baseUrl}/models`;
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      state.isOnline = false;
      state.models = [];
      state.lastChecked = Date.now();
      return;
    }
    const body = (await res.json()) as { data?: { id: string }[] };
    const models = (body.data ?? []).map((m) => m.id).filter(Boolean);
    state.isOnline = true;
    state.models = models;
    state.lastChecked = Date.now();
  } catch {
    state.isOnline = false;
    state.models = [];
    state.lastChecked = Date.now();
  }
}

export async function probeAllLocalProviders(): Promise<void> {
  await Promise.all(localProviders.map(probeLocalProvider));
}

// ---------------------------------------------------------------------------
// Polling — re-probe every 30 seconds
// ---------------------------------------------------------------------------

export function startLocalProviderPolling() {
  if (pollingHandle) return;
  pollingHandle = setInterval(() => {
    probeAllLocalProviders().catch(() => {});
  }, 30_000);
}

export function stopLocalProviderPolling() {
  if (pollingHandle) {
    clearInterval(pollingHandle);
    pollingHandle = null;
  }
}

// ---------------------------------------------------------------------------
// Convert to ProviderConfig for routing
// ---------------------------------------------------------------------------

export function getLocalProviderConfigs(): ProviderConfig[] {
  return localProviders
    .filter((lp) => lp.isOnline && lp.models.length > 0)
    .map((lp) => ({
      name: lp.name,
      baseUrl: lp.baseUrl,
      apiKey: "",
      prefixes: lp.models, // exact model IDs used as "prefixes"
      format: "openai" as const,
      keySource: "byok" as const,
      isLocal: true,
    }));
}

/** Find a local ProviderConfig that serves a specific model */
export function getLocalProviderForModel(model: string): ProviderConfig | undefined {
  for (const lp of localProviders) {
    if (lp.isOnline && lp.models.includes(model)) {
      return {
        name: lp.name,
        baseUrl: lp.baseUrl,
        apiKey: "",
        prefixes: lp.models,
        format: "openai",
        keySource: "byok",
        isLocal: true,
      };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Update base URL (from API)
// ---------------------------------------------------------------------------

export async function updateLocalProviderUrl(name: string, baseUrl: string): Promise<LocalProviderState | undefined> {
  const lp = localProviders.find((p) => p.name === name);
  if (!lp) return undefined;
  lp.baseUrl = baseUrl.replace(/\/+$/, "");
  saveSetting(`localProvider:${name}:baseUrl`, lp.baseUrl);
  await probeLocalProvider(lp);
  return lp;
}
