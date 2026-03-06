// ---------------------------------------------------------------------------
// Tests for global error handler middleware
// ---------------------------------------------------------------------------

import { describe, test, expect, afterEach } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "./error-handler";

function createApp(throwError: Error) {
  const app = new Hono();
  app.onError(errorHandler);
  app.get("/test", () => {
    throw throwError;
  });
  return app;
}

describe("errorHandler", () => {
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
  });

  test("returns 500 JSON response", async () => {
    const app = createApp(new Error("test error"));
    const res = await app.request("/test");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.type).toBe("server_error");
  });

  test("includes error message in dev mode", async () => {
    process.env.NODE_ENV = "development";
    const app = createApp(new Error("detailed error info"));
    const res = await app.request("/test");
    const body = await res.json();
    expect(body.error.message).toBe("detailed error info");
  });

  test("hides error message in production mode", async () => {
    process.env.NODE_ENV = "production";
    const app = createApp(new Error("sensitive details"));
    const res = await app.request("/test");
    const body = await res.json();
    expect(body.error.message).toBe("Internal server error");
  });

  test("error response has correct structure", async () => {
    const app = createApp(new Error("test"));
    const res = await app.request("/test");
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toHaveProperty("message");
    expect(body.error).toHaveProperty("type");
  });
});
