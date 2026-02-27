import { Hono } from "hono";
import { cors } from "hono/cors";
import stats, { websocket } from "./routes/stats";
import api from "./routes/api";
import proxy from "./routes/proxy";
import { authMiddleware } from "./lib/auth";
import { providers } from "./lib/providers";

const app = new Hono();

// CORS for Tauri WebView
app.use("*", cors({ origin: "*" }));

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

console.log("🚀 RouteBox Gateway running on http://localhost:3001");
console.log(`   Providers: ${providers.map((p) => p.name).join(", ") || "(none — set API keys)"}`);

export default {
  port: 3001,
  fetch: app.fetch,
  websocket,
};
