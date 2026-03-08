// ---------------------------------------------------------------------------
// Account routes — GET /account/me, /account/balance, /account/transactions,
//                  /account/api-keys
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { getUserById } from "../lib/users";
import { getBalanceInfo, getTransactions } from "../lib/credits";
import { getOrCreateReferralCode } from "../lib/referrals";
import { isAdminEmail } from "../middleware/admin-auth";
import { sha256Hex } from "../lib/crypto";
import { sql } from "../lib/db-cloud";
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
    uid: profile.uid,
    email: profile.email,
    displayName: profile.displayName,
    plan: profile.plan,
    balanceCents: profile.balanceCents,
    totalDepositedCents: profile.totalDepositedCents,
    totalUsedCents: profile.totalUsedCents,
    createdAt: profile.createdAt,
    isAdmin: isAdminEmail(profile.email),
  });
});

// ── GET /balance — just the balance ─────────────────────────────────────────

app.get("/balance", async (c) => {
  const userId = c.get("userId") as string;
  const info = await getBalanceInfo(userId);
  return c.json({
    balance_cents: info.balance_cents,
    bonus_cents: info.bonus_cents,
    total_cents: info.total_cents,
  });
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

// ── GET /announcement — current active announcement (if any) ─────────────────

app.get("/announcement", async (c) => {
  const [row] = await sql`
    SELECT id, title, message, type, starts_at, ends_at
    FROM announcements
    WHERE is_active = true
      AND starts_at <= now()
      AND (ends_at IS NULL OR ends_at > now())
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!row) return c.json({ announcement: null });

  return c.json({
    announcement: {
      id: row.id,
      title: row.title,
      message: row.message,
      type: row.type,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    },
  });
});

// ── GET /api-keys — list user's API keys ─────────────────────────────────────

app.get("/api-keys", async (c) => {
  const userId = c.get("userId") as string;
  const rows = await sql`
    SELECT id, name, key_prefix, last_used_at, is_active, created_at
    FROM api_keys
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
  return c.json({
    apiKeys: rows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.key_prefix,
      lastUsedAt: r.last_used_at,
      isActive: r.is_active,
      createdAt: r.created_at,
    })),
  });
});

// ── POST /api-keys — create a new API key ────────────────────────────────────

const MAX_API_KEYS_PER_USER = 20;

app.post("/api-keys", async (c) => {
  const userId = c.get("userId") as string;
  const body = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));

  // Check API key limit
  const [countRow] = await sql`
    SELECT COUNT(*)::int AS cnt FROM api_keys
    WHERE user_id = ${userId} AND is_active = true
  `;
  if ((countRow?.cnt as number) >= MAX_API_KEYS_PER_USER) {
    return c.json(
      { error: { message: `Maximum of ${MAX_API_KEYS_PER_USER} active API keys allowed`, type: "validation_error" } },
      400,
    );
  }

  // Generate rb_ key: "rb_" + 32 hex chars = 35 chars total
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  const keyHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const fullKey = `rb_${keyHex}`;
  const keyHash = await sha256Hex(fullKey);
  const keyPrefix = fullKey.substring(0, 12); // "rb_XXXXXXXX" (first 12 chars)
  const name = (body.name ?? "Default").substring(0, 100);

  const [row] = await sql`
    INSERT INTO api_keys (user_id, key_hash, key_prefix, name)
    VALUES (${userId}, ${keyHash}, ${keyPrefix}, ${name})
    RETURNING id, name, key_prefix, is_active, created_at
  `;

  // Return full key ONCE — it cannot be retrieved again
  return c.json(
    {
      id: row.id,
      name: row.name,
      keyPrefix: row.key_prefix,
      key: fullKey, // full key shown only once
      isActive: row.is_active,
      createdAt: row.created_at,
    },
    201,
  );
});

// ── DELETE /api-keys/:id — deactivate an API key ─────────────────────────────

app.delete("/api-keys/:id", async (c) => {
  const userId = c.get("userId") as string;
  const id = c.req.param("id");

  const result = await sql`
    UPDATE api_keys SET is_active = false
    WHERE id = ${id} AND user_id = ${userId}
  `;

  if (result.count === 0) {
    return c.json({ error: { message: "API key not found", type: "not_found" } }, 404);
  }

  return c.json({ success: true });
});

// ── GET /requests — recent request log (cursor-based pagination) ────────────

app.get("/requests", async (c) => {
  const userId = c.get("userId") as string;
  const afterId = c.req.query("after");
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 100);

  let rows;
  if (afterId) {
    rows = await sql`
      SELECT id, model, provider, input_tokens, output_tokens, cost_cents,
             latency_ms, status, created_at
      FROM requests
      WHERE user_id = ${userId}
        AND created_at > (SELECT created_at FROM requests WHERE id = ${afterId})
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
  } else {
    rows = await sql`
      SELECT id, model, provider, input_tokens, output_tokens, cost_cents,
             latency_ms, status, created_at
      FROM requests
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    rows = [...rows].reverse();
  }

  return c.json({
    requests: rows.map((r) => ({
      id: r.id,
      timestamp: new Date(r.created_at).getTime(),
      provider: r.provider,
      model: r.model,
      tokens: (r.input_tokens ?? 0) + (r.output_tokens ?? 0),
      inputTokens: r.input_tokens ?? 0,
      outputTokens: r.output_tokens ?? 0,
      cost: r.cost_cents / 100,
      latencyMs: r.latency_ms ?? 0,
      status: r.status === "ok" ? "success" : r.status === "fallback" ? "fallback" : "error",
    })),
  });
});

export default app;
