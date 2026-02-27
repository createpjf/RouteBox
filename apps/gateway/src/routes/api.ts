import { Hono } from "hono";
import { metrics } from "../lib/metrics";

const app = new Hono();

// Provider health
app.get("/providers", (c) => {
  const stats = metrics.getStats();
  return c.json({ providers: stats.providers });
});

// Balance
app.get("/balance", (c) => {
  return c.json({
    current: metrics.balance,
    currency: "USD",
    lowThreshold: 5,
  });
});

// API Keys
app.get("/keys", (c) => {
  return c.json({
    keys: [
      {
        id: "key_default",
        name: "Default",
        prefix: "sk-rb-",
        maskedKey: "sk-rb-xxxx...xxxx",
        plainKey: "sk-rb-mock-api-key-for-development",
        createdAt: "2025-01-15T00:00:00Z",
      },
    ],
  });
});

// Routing strategy
app.get("/routing", (c) => {
  return c.json({
    current: metrics.routingStrategy,
    strategies: [
      { id: "smart_auto", name: "Smart Auto", description: "AI picks the best route" },
      { id: "cost_first", name: "Cost First", description: "Minimize cost per token" },
      { id: "speed_first", name: "Speed First", description: "Minimize latency" },
      { id: "quality_first", name: "Quality First", description: "Use the best model available" },
    ],
  });
});

app.put("/routing", async (c) => {
  const body = await c.req.json<{ strategy_id: string }>();
  metrics.setRoutingStrategy(body.strategy_id);
  return c.json({ success: true, current: body.strategy_id });
});

// Traffic pause/resume
app.post("/traffic/pause", (c) => {
  metrics.setTrafficPaused(true);
  return c.json({ paused: true });
});

app.post("/traffic/resume", (c) => {
  metrics.setTrafficPaused(false);
  return c.json({ paused: false });
});

app.get("/traffic/status", (c) => {
  return c.json({ paused: metrics.trafficPaused });
});

export default app;
