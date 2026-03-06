// ---------------------------------------------------------------------------
// Auth routes — POST /auth/register, /auth/login, GET /auth/me
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { createUser, authenticateUser, getUserById } from "../lib/users";
import { signToken } from "../lib/jwt";
import { claimReferral } from "../lib/referrals";
import { jwtAuth } from "../middleware/jwt-auth";
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
      await claimReferral(body.referralCode, user.id).catch(() => {});
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

export default app;
