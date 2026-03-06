// ---------------------------------------------------------------------------
// GET /metrics — Prometheus text exposition format
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { serialize } from "../lib/metrics";

const app = new Hono();

app.get("/", (c) => {
  return c.text(serialize(), 200, {
    "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
  });
});

export default app;
