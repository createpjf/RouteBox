import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { metrics } from "../lib/metrics";
import { verifyToken } from "../lib/auth";

const { upgradeWebSocket, websocket } = createBunWebSocket();

const app = new Hono();

app.get(
  "/ws/stats",
  upgradeWebSocket((c) => {
    const token = new URL(c.req.url).searchParams.get("token") || "";
    const authenticated = verifyToken(token);

    let statsInterval: ReturnType<typeof setInterval> | null = null;
    let lastLogId: string | undefined;

    return {
      onOpen(_event, ws) {
        if (!authenticated) {
          ws.send(JSON.stringify({ event: "error", data: { code: "AUTH_FAILED", message: "Invalid token" } }));
          ws.close(4001, "Unauthorized");
          return;
        }

        console.log("[WS] Client connected");

        // Send initial snapshot
        ws.send(JSON.stringify({ event: "stats", data: metrics.getStats() }));

        // Push recent log entries
        const recent = metrics.getRecentLog(10);
        for (const entry of recent) {
          ws.send(JSON.stringify({
            event: "request_log",
            data: {
              id: entry.id,
              timestamp: entry.timestamp,
              provider: entry.provider,
              model: entry.model,
              tokens: entry.totalTokens,
              cost: entry.cost,
              latencyMs: entry.latencyMs,
              status: entry.status,
            },
          }));
        }
        if (recent.length) lastLogId = recent[recent.length - 1].id;

        // Broadcast stats every second + any new log entries
        statsInterval = setInterval(() => {
          ws.send(JSON.stringify({ event: "stats", data: metrics.getStats() }));

          // Push new log entries
          const newEntries = metrics.getLogSince(lastLogId);
          for (const entry of newEntries) {
            ws.send(JSON.stringify({
              event: "request_log",
              data: {
                id: entry.id,
                timestamp: entry.timestamp,
                provider: entry.provider,
                model: entry.model,
                tokens: entry.totalTokens,
                cost: entry.cost,
                latencyMs: entry.latencyMs,
                status: entry.status,
              },
            }));
            lastLogId = entry.id;
          }
        }, 1000);
      },
      onMessage(event, ws) {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.action === "ping") {
            ws.send(JSON.stringify({ event: "pong", data: null }));
          }
        } catch {
          // ignore invalid JSON
        }
      },
      onClose() {
        console.log("[WS] Client disconnected");
        if (statsInterval) clearInterval(statsInterval);
      },
    };
  })
);

export { websocket };
export default app;
