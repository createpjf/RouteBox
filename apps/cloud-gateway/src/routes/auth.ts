// ---------------------------------------------------------------------------
// Auth routes — POST /auth/register, /auth/login, GET /auth/me
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { createUser, authenticateUser, getUserById } from "../lib/users";
import { signToken } from "../lib/jwt";
import { claimReferral } from "../lib/referrals";
import { jwtAuth } from "../middleware/jwt-auth";
import { sql } from "../lib/db-cloud";
import { sendPasswordResetEmail } from "../lib/email";
import { sha256Hex } from "../lib/crypto";
import { rateLimitForgotPassword } from "../middleware/rate-limit";
import { log } from "../lib/logger";
import type { CloudEnv } from "../types";

const app = new Hono<CloudEnv>();

// ── POST /register ──────────────────────────────────────────────────────────

app.post("/register", async (c) => {
  const body = await c.req.json<{
    email: string;
    password: string;
    name?: string;
    referralCode?: string;
  }>();

  // Validate
  if (!body.email || !body.password) {
    return c.json(
      { error: { message: "Email and password are required", type: "validation_error" } },
      400,
    );
  }
  if (body.email.length > 254) {
    return c.json(
      { error: { message: "Email too long (max 254 characters)", type: "validation_error" } },
      400,
    );
  }
  if (body.password.length < 6) {
    return c.json(
      { error: { message: "Password must be at least 6 characters", type: "validation_error" } },
      400,
    );
  }
  if (body.password.length > 72) {
    return c.json(
      { error: { message: "Password too long (max 72 characters)", type: "validation_error" } },
      400,
    );
  }
  if (body.name && body.name.length > 100) {
    return c.json(
      { error: { message: "Name too long (max 100 characters)", type: "validation_error" } },
      400,
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.email)) {
    return c.json(
      { error: { message: "Invalid email format", type: "validation_error" } },
      400,
    );
  }

  try {
    const user = await createUser(body.email, body.password, body.name);
    const token = await signToken(user.id, user.email);

    // Process referral code if provided
    if (body.referralCode) {
      await claimReferral(body.referralCode, user.id).catch((err) => {
        log.warn("referral_claim_failed", {
          userId: user.id,
          referralCode: body.referralCode,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return c.json({
      token,
      user: {
        id: user.id,
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        plan: user.plan,
        balanceCents: 0,
      },
    });
  } catch (err: unknown) {
    // Duplicate email
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return c.json(
        { error: { message: "Email already registered", type: "conflict_error" } },
        409,
      );
    }
    throw err;
  }
});

// ── POST /login ─────────────────────────────────────────────────────────────

app.post("/login", async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();

  if (!body.email || !body.password) {
    return c.json(
      { error: { message: "Email and password are required", type: "validation_error" } },
      400,
    );
  }
  if (body.email.length > 254 || body.password.length > 72) {
    return c.json(
      { error: { message: "Invalid email or password", type: "auth_error" } },
      401,
    );
  }

  const user = await authenticateUser(body.email, body.password);
  if (!user) {
    return c.json(
      { error: { message: "Invalid email or password", type: "auth_error" } },
      401,
    );
  }

  const token = await signToken(user.id, user.email);

  // Get full profile with balance
  const profile = await getUserById(user.id);

  return c.json({
    token,
    user: {
      id: user.id,
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      plan: user.plan,
      balanceCents: profile?.balanceCents ?? 0,
    },
  });
});

// ── GET /me (requires JWT) ──────────────────────────────────────────────────

app.get("/me", jwtAuth, async (c) => {
  const userId = c.get("userId") as string;
  const profile = await getUserById(userId);

  if (!profile) {
    return c.json(
      { error: { message: "User not found", type: "not_found" } },
      404,
    );
  }

  return c.json({
    user: {
      id: profile.id,
      uid: profile.uid,
      email: profile.email,
      displayName: profile.displayName,
      plan: profile.plan,
      balanceCents: profile.balanceCents,
      totalDepositedCents: profile.totalDepositedCents,
      totalUsedCents: profile.totalUsedCents,
      createdAt: profile.createdAt,
    },
  });
});

// ── POST /forgot-password ───────────────────────────────────────────────────

app.post("/forgot-password", rateLimitForgotPassword, async (c) => {
  const body = await c.req.json<{ email: string }>();

  if (!body.email) {
    return c.json(
      { error: { message: "Email is required", type: "validation_error" } },
      400,
    );
  }

  // Always return success to prevent email enumeration
  const respond = () => c.json({ success: true });

  try {
    // Cleanup expired tokens (older than 7 days)
    await sql`
      DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '7 days'
    `.catch((err) => {
      log.warn("expired_token_cleanup_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Rate limit: 1 request per email per 10 minutes
    const [recent] = await sql`
      SELECT 1 FROM password_reset_tokens prt
      JOIN users u ON u.id = prt.user_id
      WHERE u.email = ${body.email}
        AND prt.created_at > now() - interval '10 minutes'
      LIMIT 1
    `;
    if (recent) {
      return respond();
    }

    // Look up user
    const [user] = await sql`SELECT id, email FROM users WHERE email = ${body.email}`;
    if (!user) {
      return respond();
    }

    // Generate token
    const rawToken = crypto.randomUUID();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await sql`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (${user.id}, ${tokenHash}, ${expiresAt})
    `;

    // Build reset URL
    const appUrl = process.env.APP_URL ?? "https://routebox.dev";
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;

    await sendPasswordResetEmail(user.email, resetUrl);
    log.info("password_reset_requested", { userId: user.id });
  } catch (err) {
    log.error("forgot_password_error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return respond();
});

// ── POST /reset-password ────────────────────────────────────────────────────

app.post("/reset-password", async (c) => {
  const body = await c.req.json<{ token: string; newPassword: string }>();

  if (!body.token || !body.newPassword) {
    return c.json(
      { error: { message: "Token and new password are required", type: "validation_error" } },
      400,
    );
  }

  if (body.newPassword.length < 6) {
    return c.json(
      { error: { message: "Password must be at least 6 characters", type: "validation_error" } },
      400,
    );
  }
  if (body.newPassword.length > 72) {
    return c.json(
      { error: { message: "Password too long (max 72 characters)", type: "validation_error" } },
      400,
    );
  }

  const tokenHash = await sha256Hex(body.token);

  const [resetToken] = await sql`
    SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at
    FROM password_reset_tokens prt
    WHERE prt.token_hash = ${tokenHash}
  `;

  if (!resetToken) {
    return c.json(
      { error: { message: "Invalid or expired reset token", type: "auth_error" } },
      400,
    );
  }

  if (resetToken.used_at) {
    return c.json(
      { error: { message: "This reset token has already been used", type: "auth_error" } },
      400,
    );
  }

  if (new Date(resetToken.expires_at) < new Date()) {
    return c.json(
      { error: { message: "Invalid or expired reset token", type: "auth_error" } },
      400,
    );
  }

  // Hash new password and update
  const passwordHash = await Bun.password.hash(body.newPassword, {
    algorithm: "bcrypt",
    cost: 10,
  });

  await sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${resetToken.user_id}`;
  await sql`UPDATE password_reset_tokens SET used_at = now() WHERE id = ${resetToken.id}`;

  log.info("password_reset_completed", { userId: resetToken.user_id });

  return c.json({ success: true });
});

export default app;
