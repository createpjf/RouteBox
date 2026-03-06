// ---------------------------------------------------------------------------
// Account routes — GET /account/me, /account/balance, /account/transactions
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getUserById } from "../lib/users";
import { getBalance, getTransactions } from "../lib/credits";
import { getOrCreateReferralCode } from "../lib/referrals";
import type { CloudEnv } from "../types";

const app = new Hono<CloudEnv>();

// ── GET /me — full user profile ─────────────────────────────────────────────

app.get("/me", async (c) => {
  const userId = c.get("userId") as string;
  const profile = await getUserById(userId);

  if (!profile) {
    return c.json(
      { error: { message: "User not found", type: "not_found" } },
      404,
    );
  }

  return c.json({
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName,
    plan: profile.plan,
    balanceCents: profile.balanceCents,
    totalDepositedCents: profile.totalDepositedCents,
    totalUsedCents: profile.totalUsedCents,
    createdAt: profile.createdAt,
  });
});

// ── GET /balance — just the balance ─────────────────────────────────────────

app.get("/balance", async (c) => {
  const userId = c.get("userId") as string;
  const balance = await getBalance(userId);
  return c.json({ balance_cents: balance });
});

// ── GET /transactions — transaction history ─────────────────────────────────

app.get("/transactions", async (c) => {
  const userId = c.get("userId") as string;
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  const transactions = await getTransactions(userId, limit, offset);
  return c.json({ transactions });
});

// ── GET /referral — get or create referral code + stats ──────────────────────

app.get("/referral", async (c) => {
  const userId = c.get("userId") as string;
  const referral = await getOrCreateReferralCode(userId);
  return c.json(referral);
});

export default app;
