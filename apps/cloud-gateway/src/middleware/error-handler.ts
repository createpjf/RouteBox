// ---------------------------------------------------------------------------
// Global error handler — prevents stack trace leakage in production
// ---------------------------------------------------------------------------

import type { Context } from "hono";
import * as Sentry from "@sentry/bun";
import { log } from "../lib/logger";
import { incCounter } from "../lib/metrics";

export function errorHandler(err: Error, c: Context): Response {
  const isDev = process.env.NODE_ENV !== "production";
  log.error("unhandled_error", {
    requestId: c.get("requestId"),
    userId: c.get("userId"),
    method: c.req.method,
    path: c.req.path,
    error: err.message,
    stack: isDev ? err.stack : undefined,
  });
  incCounter("errors_total", { type: "unhandled" });

  // Report to Sentry (no-op if DSN not configured)
  Sentry.captureException(err, {
    tags: {
      requestId: c.get("requestId") as string,
      method: c.req.method,
      path: c.req.path,
    },
    user: { id: c.get("userId") as string | undefined },
  });

  return c.json(
    {
      error: {
        message: isDev ? err.message : "Internal server error",
        type: "server_error",
      },
    },
    500,
  );
}
