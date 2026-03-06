// ---------------------------------------------------------------------------
// JWT authentication middleware for Hono
// Supports both JWT tokens and rb_ API keys
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";
import { verifyToken } from "../lib/jwt";
import { sql } from "../lib/db-cloud";
import type { CloudEnv } from "../types";

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
    try {
      const hash = await sha256Hex(token);
      const [key] = await sql`
        SELECT ak.user_id, ak.key_hash, u.plan, u.email
        FROM api_keys ak
        JOIN users u ON u.id = ak.user_id
        WHERE ak.key_hash = ${hash} AND ak.is_active = true
      `;
      if (!key) {
        return c.json(
          { error: { message: "Invalid or revoked API key", type: "auth_error" } },
          401,
        );
      }
      // Update last_used_at asynchronously (fire-and-forget)
      sql`UPDATE api_keys SET last_used_at = now() WHERE key_hash = ${hash}`.catch(() => {});

      c.set("userId", key.user_id);
      c.set("email", key.email);
      c.set("userPlan", (key.plan as string) ?? "free");
    } catch {
      return c.json(
        { error: { message: "Invalid or revoked API key", type: "auth_error" } },
        401,
      );
    }
    await next();
    return;
  }

  // ── JWT path ──────────────────────────────────────────────────────────────
  try {
    const payload = await verifyToken(token);
    c.set("userId", payload.sub);
    c.set("email", payload.email);

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
