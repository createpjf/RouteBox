// ---------------------------------------------------------------------------
// Admin authentication middleware
// Checks if the authenticated user's email is in the ADMIN_EMAILS list
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";
import { verifyToken } from "../lib/jwt";
import type { CloudEnv } from "../types";

const ADMIN_EMAILS: Set<string> = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/** Check if an email is in the admin list */
export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.has(email.toLowerCase());
}

/**
 * Admin auth middleware — requires a valid JWT whose email is in ADMIN_EMAILS.
 * Must be applied AFTER jwtAuth or used standalone (it verifies the token itself).
 */
export async function adminAuth(c: Context<CloudEnv>, next: Next) {
  // If no admin emails configured, deny all
  if (ADMIN_EMAILS.size === 0) {
    return c.json(
      { error: { message: "Admin access not configured", type: "auth_error" } },
      403,
    );
  }

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
    const email = payload.email?.toLowerCase();

    if (!email || !ADMIN_EMAILS.has(email)) {
      return c.json(
        { error: { message: "Insufficient privileges", type: "auth_error" } },
        403,
      );
    }

    c.set("userId", payload.sub);
    c.set("email", email);
  } catch {
    return c.json(
      { error: { message: "Invalid or expired token", type: "auth_error" } },
      401,
    );
  }

  await next();
}
