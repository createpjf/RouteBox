import { Hono } from "hono";
import { cors } from "hono/cors";
import stats, { websocket } from "./routes/stats";
import api from "./routes/api";
import proxy from "./routes/proxy";
import { authMiddleware } from "./lib/auth";
import { providers, rebuildProviders } from "./lib/providers";
import { loadAllProviderKeys } from "./lib/db";
import { metrics } from "./lib/metrics";

// ── Load DB keys on startup ─────────────────────────────────────────────────
const dbKeys = new Map<string, string>();
for (const row of loadAllProviderKeys()) {
  dbKeys.set(row.provider_name, row.api_key);
}
if (dbKeys.size > 0) {
  rebuildProviders(dbKeys);
  metrics.syncProviders();
}

const app = new Hono();

// CORS — restricted to Tauri webview and local development
function isAllowedOrigin(origin: string): boolean {
  if (origin === "tauri://localhost") return true;
  try {
    const url = new URL(origin);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname === "localhost"
    ) {
      return true;
    }
  } catch {
    // malformed origin
  }
  return false;
}

app.use(
  "*",
  cors({
    origin: (origin) => (isAllowedOrigin(origin) ? origin : ""),
  }),
);

// Health check (no auth)
app.get("/health", (c) => c.json({
  status: "ok",
  uptime: process.uptime(),
  providers: providers.map((p) => p.name),
}));

// Auth for REST + proxy
app.use("/api/v1/*", authMiddleware);
app.use("/v1/*", authMiddleware);

// WebSocket stats (auth checked inside upgrade handler via query param)
app.route("/", stats);

// Control-plane REST API
app.route("/api/v1", api);

// LLM proxy (OpenAI-compatible)
app.route("/v1", proxy);

const port = parseInt(process.env.PORT || "3001", 10);

console.log(`🚀 RouteBox Gateway running on http://localhost:${port}`);
console.log(`   Providers: ${providers.map((p) => p.name).join(", ") || "(none — set API keys)"}`);

process.on("SIGTERM", () => { console.log("Shutting down..."); process.exit(0); });
process.on("SIGINT", () => { console.log("Shutting down..."); process.exit(0); });

export default {
  port,
  fetch: app.fetch,
  websocket,
};
