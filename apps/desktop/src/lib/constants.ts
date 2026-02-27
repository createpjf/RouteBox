let gatewayUrl = "http://localhost:3001";
let authToken = "";

export function getGatewayUrl() {
  return gatewayUrl;
}

export function getWsUrl() {
  const base = gatewayUrl.replace(/^http/, "ws") + "/ws/stats";
  return authToken ? `${base}?token=${encodeURIComponent(authToken)}` : base;
}

export function setGatewayUrl(url: string) {
  gatewayUrl = url.replace(/\/+$/, "");
}

export function getAuthToken() {
  return authToken;
}

export function setAuthToken(token: string) {
  authToken = token;
}

export const WS_RECONNECT_MAX_DELAY = 30_000;
export const WS_PING_INTERVAL = 25_000;

export const PROVIDER_COLORS: Record<string, string> = {
  OpenAI: "#10A37F",
  Anthropic: "#D4A574",
  Google: "#4285F4",
  DeepSeek: "#4D6BFE",
  Mistral: "#FF7000",
  Groq: "#F55036",
  Together: "#6366F1",
  Flock: "#7C3AED",
};

export const ROUTING_STRATEGIES = [
  { id: "smart_auto", name: "Smart Auto", description: "AI picks the best route" },
  { id: "cost_first", name: "Cost First", description: "Minimize cost per token" },
  { id: "speed_first", name: "Speed First", description: "Minimize latency" },
  { id: "quality_first", name: "Quality First", description: "Use the best model available" },
] as const;
