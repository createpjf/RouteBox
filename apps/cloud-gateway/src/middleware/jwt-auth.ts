// ---------------------------------------------------------------------------
// JWT authentication middleware for Hono
// Supports both JWT tokens and rb_ API keys
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";
import { verifyToken } from "../lib/jwt";
import { sha256Hex } from "../lib/crypto";
import { sql } from "../lib/db-cloud";
import { log } from "../lib/logger";
import type { CloudEnv } from "../types";

/**
 * Extracts Bearer token from Authorization header.
 * Supports two auth paths:
 *   1. rb_ prefix → API key (SHA-256 hash lookup in api_keys table)
 *   2. JWT token  → standard JWT verification
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

  // ── API key path ──────────────────────────────────────────────────────────
  if (token.startsWith("rb_")) {
    const hash = await sha256Hex(token);

    // DB query in its own try/catch — DB failure → 503, not 401
    let key: Record<string, unknown> | undefined;
    try {
      [key] = await sql`
        SELECT ak.user_id, ak.key_hash, u.plan, u.email, u.status
        FROM api_keys ak
        JOIN users u ON u.id = ak.user_id
        WHERE ak.key_hash = ${hash} AND ak.is_active = true
      `;
    } catch {
      return c.json(
        { error: { message: "Service temporarily unavailable", type: "server_error" } },
        503,
      );
    }

    if (!key) {
      return c.json(
        { error: { message: "Invalid or revoked API key", type: "auth_error" } },
        401,
      );
    }

    const keyStatus = (key.status as string) ?? "active";
    if (keyStatus !== "active") {
      const msg = keyStatus === "suspended" ? "Account suspended. Contact support." : "Access denied.";
      return c.json({ error: { message: msg, type: "auth_error" } }, 403);
    }

    // Update last_used_at asynchronously (fire-and-forget)
    sql`UPDATE api_keys SET last_used_at = now() WHERE key_hash = ${hash}`.catch((err) => {
      log.warn("api_key_last_used_update_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    c.set("userId", key.user_id as string);
    c.set("email", key.email as string);
    c.set("userPlan", (key.plan as string) ?? "starter");
    await next();
    return;
  }

  // ── JWT path ──────────────────────────────────────────────────────────────
  // Token verification in its own try/catch → 401 on bad token
  let payload: { sub: string; email: string };
  try {
    payload = await verifyToken(token);
  } catch {
    return c.json(
      { error: { message: "Invalid or expired token", type: "auth_error" } },
      401,
    );
  }

  c.set("userId", payload.sub);
  c.set("email", payload.email);

  // Plan lookup in its own try/catch — DB failure → 503, not 401
  let user: Record<string, unknown> | undefined;
  try {
    [user] = await sql`SELECT plan, status FROM users WHERE id = ${payload.sub}`;
  } catch {
    return c.json(
      { error: { message: "Service temporarily unavailable", type: "server_error" } },
      503,
    );
  }

  const userStatus = (user?.status as string) ?? "active";
  if (userStatus !== "active") {
    const msg = userStatus === "suspended" ? "Account suspended. Contact support." : "Access denied.";
    return c.json({ error: { message: msg, type: "auth_error" } }, 403);
  }

  c.set("userPlan", (user?.plan as string) ?? "starter");
  await next();
}
