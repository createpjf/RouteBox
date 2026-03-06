// ---------------------------------------------------------------------------
// Admin SQL queries — aggregated stats for the admin dashboard
// ---------------------------------------------------------------------------

import { sql, withTx } from "./db-cloud";

// ── Overview stats ─────────────────────────────────────────────────────────

export async function getAdminStats() {
  const [userStats] = await sql`
    SELECT
      COUNT(*)::int AS total_users,
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today_registrations,
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::int AS week_registrations
    FROM users
  `;

  const [depositStats] = await sql`
    SELECT
      COALESCE(SUM(amount_cents) FILTER (WHERE type = 'deposit'), 0)::int AS total_deposited_cents,
      COALESCE(SUM(amount_cents) FILTER (WHERE type = 'deposit' AND created_at >= CURRENT_DATE), 0)::int AS today_deposited_cents,
      COUNT(*) FILTER (WHERE type = 'deposit')::int AS total_deposit_count,
      COUNT(*) FILTER (WHERE type = 'deposit' AND created_at >= CURRENT_DATE)::int AS today_deposit_count
    FROM transactions
  `;

  const [usageStats] = await sql`
    SELECT
      COUNT(*)::int AS total_requests,
      COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today_requests,
      COALESCE(SUM(cost_cents), 0)::int AS total_cost_cents,
      COALESCE(SUM(cost_cents) FILTER (WHERE created_at >= CURRENT_DATE), 0)::int AS today_cost_cents,
      COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS total_tokens
    FROM requests
  `;

  const [balanceStats] = await sql`
    SELECT
      COALESCE(SUM(balance_cents), 0)::int AS total_outstanding_cents,
      COALESCE(SUM(total_used_cents), 0)::int AS total_used_cents
    FROM credits
  `;

  const [referralStats] = await sql`
    SELECT
      COUNT(DISTINCT r.id)::int AS total_codes,
      COALESCE(SUM(r.uses), 0)::int AS total_claims,
      COUNT(DISTINCT rc.id) FILTER (WHERE rc.referrer_rewarded = true)::int AS rewards_distributed
    FROM referrals r
    LEFT JOIN referral_claims rc ON rc.referral_id = r.id
  `;

  return {
    users: {
      total: userStats.total_users,
      todayRegistrations: userStats.today_registrations,
      weekRegistrations: userStats.week_registrations,
    },
    deposits: {
      totalCents: depositStats.total_deposited_cents,
      todayCents: depositStats.today_deposited_cents,
      totalCount: depositStats.total_deposit_count,
      todayCount: depositStats.today_deposit_count,
    },
    usage: {
      totalRequests: usageStats.total_requests,
      todayRequests: usageStats.today_requests,
      totalCostCents: usageStats.total_cost_cents,
      todayCostCents: usageStats.today_cost_cents,
      totalTokens: Number(usageStats.total_tokens),
    },
    balance: {
      totalOutstandingCents: balanceStats.total_outstanding_cents,
      totalUsedCents: balanceStats.total_used_cents,
    },
    referrals: {
      totalCodes: referralStats.total_codes,
      totalClaims: referralStats.total_claims,
      rewardsDistributed: referralStats.rewards_distributed,
    },
  };
}

// ── User list ──────────────────────────────────────────────────────────────

export async function getAdminUsers(limit = 100, offset = 0, search = "") {
  const rows = await sql`
    SELECT
      u.id, u.email, u.display_name, u.plan,
      u.created_at,
      COALESCE(c.balance_cents, 0) AS balance_cents,
      COALESCE(c.total_deposited_cents, 0) AS total_deposited_cents,
      COALESCE(c.total_used_cents, 0) AS total_used_cents,
      (SELECT COUNT(*)::int FROM requests WHERE user_id = u.id) AS request_count,
      COUNT(*) OVER() AS total_count
    FROM users u
    LEFT JOIN credits c ON c.user_id = u.id
    WHERE (${search} = '' OR u.email ILIKE ${'%' + search + '%'})
    ORDER BY u.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  return {
    users: rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      plan: r.plan,
      createdAt: r.created_at,
      balanceCents: r.balance_cents,
      totalDepositedCents: r.total_deposited_cents,
      totalUsedCents: r.total_used_cents,
      requestCount: r.request_count,
    })),
    total,
  };
}

// ── Recent transactions (all users) ────────────────────────────────────────

export async function getAdminTransactions(limit = 50, offset = 0) {
  const rows = await sql`
    SELECT
      t.id, t.user_id, t.type, t.amount_cents, t.balance_after_cents,
      t.description, t.payment_ref, t.model, t.created_at,
      u.email AS user_email,
      COUNT(*) OVER() AS total_count
    FROM transactions t
    JOIN users u ON u.id = t.user_id
    ORDER BY t.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  return {
    transactions: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userEmail: r.user_email,
      type: r.type,
      amountCents: r.amount_cents,
      balanceAfterCents: r.balance_after_cents,
      description: r.description,
      paymentRef: r.payment_ref,
      model: r.model,
      createdAt: r.created_at,
    })),
    total,
  };
}

// ── Usage breakdown by model ───────────────────────────────────────────────

export async function getAdminUsageByModel(days = 7) {
  const rows = await sql`
    SELECT
      model,
      COUNT(*)::int AS requests,
      COALESCE(SUM(cost_cents), 0)::int AS cost_cents,
      COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
      COALESCE(ROUND(AVG(latency_ms)), 0)::int AS avg_latency_ms
    FROM requests
    WHERE created_at >= CURRENT_DATE - make_interval(days => ${days})
    GROUP BY model
    ORDER BY requests DESC
  `;

  return rows.map((r) => ({
    model: r.model,
    requests: r.requests,
    costCents: r.cost_cents,
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    avgLatencyMs: r.avg_latency_ms,
  }));
}

// ── Usage breakdown by provider ────────────────────────────────────────────

export async function getAdminUsageByProvider(days = 7) {
  const rows = await sql`
    SELECT
      provider,
      COUNT(*)::int AS requests,
      COALESCE(SUM(cost_cents), 0)::int AS cost_cents,
      COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS total_tokens
    FROM requests
    WHERE created_at >= CURRENT_DATE - make_interval(days => ${days})
    GROUP BY provider
    ORDER BY requests DESC
  `;

  return rows.map((r) => ({
    provider: r.provider,
    requests: r.requests,
    costCents: r.cost_cents,
    totalTokens: Number(r.total_tokens),
  }));
}

// ── Daily usage trend ──────────────────────────────────────────────────────

export async function getAdminDailyTrend(days = 30) {
  const rows = await sql`
    SELECT
      TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
      COUNT(*)::int AS requests,
      COALESCE(SUM(cost_cents), 0)::int AS cost_cents,
      COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS total_tokens,
      COUNT(DISTINCT user_id)::int AS active_users
    FROM requests
    WHERE created_at >= CURRENT_DATE - make_interval(days => ${days})
    GROUP BY date
    ORDER BY date
  `;

  return rows.map((r) => ({
    date: r.date,
    requests: r.requests,
    costCents: r.cost_cents,
    totalTokens: Number(r.total_tokens),
    activeUsers: r.active_users,
  }));
}

// ── Daily registration trend ───────────────────────────────────────────────

export async function getAdminRegistrationTrend(days = 30) {
  const rows = await sql`
    SELECT
      TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
      COUNT(*)::int AS registrations
    FROM users
    WHERE created_at >= CURRENT_DATE - make_interval(days => ${days})
    GROUP BY date
    ORDER BY date
  `;

  return rows.map((r) => ({
    date: r.date,
    registrations: r.registrations,
  }));
}

// ── Revenue trend (deposits by day) ────────────────────────────────────────

export async function getAdminRevenueTrend(days = 30) {
  const rows = await sql`
    SELECT
      TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
      COALESCE(SUM(amount_cents) FILTER (WHERE type = 'deposit'), 0)::int AS deposit_cents,
      COUNT(*) FILTER (WHERE type = 'deposit')::int AS deposit_count
    FROM transactions
    WHERE created_at >= CURRENT_DATE - make_interval(days => ${days})
    GROUP BY date
    ORDER BY date
  `;

  return rows.map((r) => ({
    date: r.date,
    depositCents: r.deposit_cents,
    depositCount: r.deposit_count,
  }));
}

// ── Referral stats ──────────────────────────────────────────────────────

export async function getAdminReferralStats() {
  const [totals] = await sql`
    SELECT
      COUNT(DISTINCT r.id)::int AS total_codes,
      COALESCE(SUM(r.uses), 0)::int AS total_claims,
      COUNT(DISTINCT rc.id) FILTER (WHERE rc.referrer_rewarded = true)::int AS rewards_given,
      COALESCE(
        COUNT(DISTINCT rc.id) FILTER (WHERE rc.referrer_rewarded = true) *
        (SELECT COALESCE(reward_cents, 200) FROM referrals LIMIT 1), 0
      )::int AS total_reward_cents
    FROM referrals r
    LEFT JOIN referral_claims rc ON rc.referral_id = r.id
  `;

  return {
    totalCodes: totals.total_codes,
    totalClaims: totals.total_claims,
    rewardsGiven: totals.rewards_given,
    totalRewardCents: totals.total_reward_cents,
  };
}

export async function getAdminTopReferrers(limit = 20) {
  const rows = await sql`
    SELECT
      u.email,
      r.code,
      r.uses,
      COUNT(rc.id) FILTER (WHERE rc.referrer_rewarded = true)::int AS rewards_earned,
      COUNT(rc.id) FILTER (WHERE rc.referrer_rewarded = true)::int * r.reward_cents AS total_earned_cents
    FROM referrals r
    JOIN users u ON u.id = r.referrer_id
    LEFT JOIN referral_claims rc ON rc.referral_id = r.id
    GROUP BY u.email, r.code, r.uses, r.reward_cents
    ORDER BY r.uses DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    email: r.email,
    code: r.code,
    uses: r.uses,
    rewardsEarned: r.rewards_earned,
    totalEarnedCents: r.total_earned_cents,
  }));
}

// ── User management ──────────────────────────────────────────────────────

export async function updateUserPlan(userId: string, plan: string): Promise<void> {
  const validPlans = ["free", "pro"];
  if (!validPlans.includes(plan)) throw new Error("Invalid plan");
  await sql`UPDATE users SET plan = ${plan}, updated_at = now() WHERE id = ${userId}`;
}

export async function adjustUserBalance(
  userId: string,
  amountCents: number,
  reason: string,
): Promise<{ newBalance: number }> {
  const result = await withTx(async (tx) => {
    // Lock credits row
    const [row] = await tx`
      SELECT balance_cents FROM credits
      WHERE user_id = ${userId}
      FOR UPDATE
    `;

    if (!row) {
      // No credits row yet — create one
      const newBalance = Math.max(0, amountCents);
      await tx`
        INSERT INTO credits (user_id, balance_cents, total_deposited_cents)
        VALUES (${userId}, ${newBalance}, ${amountCents > 0 ? amountCents : 0})
      `;
      await tx`
        INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, description)
        VALUES (${userId}, 'admin_adjustment', ${amountCents}, ${newBalance}, ${reason})
      `;
      return { newBalance };
    }

    const newBalance = Math.max(0, (row.balance_cents as number) + amountCents);

    await tx`
      UPDATE credits
      SET balance_cents = ${newBalance},
          total_deposited_cents = CASE WHEN ${amountCents} > 0
            THEN total_deposited_cents + ${amountCents} ELSE total_deposited_cents END,
          updated_at = now()
      WHERE user_id = ${userId}
    `;

    await tx`
      INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, description)
      VALUES (${userId}, 'admin_adjustment', ${amountCents}, ${newBalance}, ${reason})
    `;

    return { newBalance };
  });

  return result;
}

// ── User detail (single user) ─────────────────────────────────────────────

export async function getAdminUser(userId: string) {
  const [row] = await sql`
    SELECT
      u.id, u.email, u.display_name, u.plan, u.created_at, u.updated_at,
      COALESCE(c.balance_cents, 0) AS balance_cents,
      COALESCE(c.total_deposited_cents, 0) AS total_deposited_cents,
      COALESCE(c.total_used_cents, 0) AS total_used_cents,
      (SELECT COUNT(*)::int FROM requests WHERE user_id = u.id) AS request_count,
      (SELECT COUNT(*)::int FROM transactions WHERE user_id = u.id) AS transaction_count
    FROM users u
    LEFT JOIN credits c ON c.user_id = u.id
    WHERE u.id = ${userId}
  `;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    plan: row.plan,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    balanceCents: row.balance_cents,
    totalDepositedCents: row.total_deposited_cents,
    totalUsedCents: row.total_used_cents,
    requestCount: row.request_count,
    transactionCount: row.transaction_count,
  };
}

export async function getUserTransactions(userId: string, limit = 50, offset = 0) {
  const rows = await sql`
    SELECT
      id, type, amount_cents, balance_after_cents, description, payment_ref, model, created_at,
      COUNT(*) OVER() AS total_count
    FROM transactions
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  return {
    transactions: rows.map((r) => ({
      id: r.id,
      type: r.type,
      amountCents: r.amount_cents,
      balanceAfterCents: r.balance_after_cents,
      description: r.description,
      paymentRef: r.payment_ref,
      model: r.model,
      createdAt: r.created_at,
    })),
    total,
  };
}

export async function getUserRequests(userId: string, limit = 50, offset = 0) {
  const rows = await sql`
    SELECT
      id, model, provider, input_tokens, output_tokens, cost_cents, latency_ms, status, created_at,
      COUNT(*) OVER() AS total_count
    FROM requests
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  return {
    requests: rows.map((r) => ({
      id: r.id,
      model: r.model,
      provider: r.provider,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costCents: r.cost_cents,
      latencyMs: r.latency_ms,
      status: r.status,
      createdAt: r.created_at,
    })),
    total,
  };
}

export async function getUserModelBreakdown(userId: string, days = 30) {
  const rows = await sql`
    SELECT
      model,
      COUNT(*)::int AS requests,
      COALESCE(SUM(cost_cents), 0)::int AS cost_cents,
      COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS total_tokens
    FROM requests
    WHERE user_id = ${userId}
      AND created_at >= CURRENT_DATE - make_interval(days => ${days})
    GROUP BY model
    ORDER BY requests DESC
  `;
  return rows.map((r) => ({
    model: r.model,
    requests: r.requests,
    costCents: r.cost_cents,
    totalTokens: Number(r.total_tokens),
  }));
}

// ── Recent referral claims ───────────────────────────────────────────────

export async function getAdminRecentReferralClaims(limit = 50) {
  const rows = await sql`
    SELECT
      rc.created_at,
      referred.email AS referred_email,
      referrer.email AS referrer_email,
      r.code,
      rc.referred_rewarded,
      rc.referrer_rewarded
    FROM referral_claims rc
    JOIN referrals r ON r.id = rc.referral_id
    JOIN users referred ON referred.id = rc.referred_user_id
    JOIN users referrer ON referrer.id = r.referrer_id
    ORDER BY rc.created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    createdAt: r.created_at,
    referredEmail: r.referred_email,
    referrerEmail: r.referrer_email,
    code: r.code,
    referredRewarded: r.referred_rewarded,
    referrerRewarded: r.referrer_rewarded,
  }));
}
