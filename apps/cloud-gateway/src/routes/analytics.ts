// ---------------------------------------------------------------------------
// Analytics routes — GET /account/analytics
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getCloudAnalytics } from "../lib/analytics";
import type { CloudEnv } from "../types";

const app = new Hono<CloudEnv>();

// ── GET /analytics — usage analytics with charts data ────────────────────────

app.get("/analytics", async (c) => {
  const userId = c.get("userId") as string;
  const period = c.req.query("period") ?? "today";

  if (!["today", "7d", "30d"].includes(period)) {
    return c.json(
      { error: { message: "Invalid period. Use: today, 7d, 30d", type: "validation_error" } },
      400,
    );
  }

  const data = await getCloudAnalytics(userId, period);
  return c.json(data);
});

export default app;
