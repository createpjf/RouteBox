// ---------------------------------------------------------------------------
// JWT authentication middleware for Hono
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";
import { verifyToken } from "../lib/jwt";
import { sql } from "../lib/db-cloud";
import type { CloudEnv } from "../types";

/**
 * Extracts Bearer token from Authorization header,
 * verifies JWT, and injects user info into context.
 */
export async function jwtAuth(c: Context<CloudEnv>, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      { error: { message: "Missing or invalid Authorization header", type: "auth_error" } },
      401,
    );
  }

  const token = authHeader.slice(7);
  try {
    const payload = await verifyToken(token);
    c.set("userId", payload.sub);
    c.set("email", payload.email);

    // Load user plan for dynamic markup
    const [user] = await sql`SELECT plan FROM users WHERE id = ${payload.sub}`;
    c.set("userPlan", (user?.plan as string) ?? "free");
  } catch {
    return c.json(
      { error: { message: "Invalid or expired token", type: "auth_error" } },
      401,
    );
  }

  await next();
}
