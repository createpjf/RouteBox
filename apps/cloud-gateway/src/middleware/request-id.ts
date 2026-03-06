// ---------------------------------------------------------------------------
// Request ID middleware — generates UUID per request, propagates via context
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { Context, Next } from "hono";
import type { CloudEnv } from "../types";

export async function requestIdMiddleware(
  c: Context<CloudEnv>,
  next: Next,
) {
  const requestId = c.req.header("X-Request-ID") ?? randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-ID", requestId);
  await next();
}
