// ---------------------------------------------------------------------------
// Credits balance management — deposit, deduct, query (transactional)
// ---------------------------------------------------------------------------

import { sql, withTx } from "./db-cloud";

export interface BalanceInfo {
  balance_cents: number;
  bonus_cents: number;
  total_cents: number;
}

/** Get current balance (balance + bonus) */
export async function getBalance(userId: string): Promise<number> {
  const [row] = await sql`
    SELECT balance_cents FROM credits WHERE user_id = ${userId}
  `;
  return row?.balance_cents ?? 0;
}

/** Get full balance info including bonus */
export async function getBalanceInfo(userId: string): Promise<BalanceInfo> {
  const [row] = await sql`
    SELECT balance_cents, bonus_cents FROM credits WHERE user_id = ${userId}
  `;
  const balance = (row?.balance_cents as number) ?? 0;
  const bonus = (row?.bonus_cents as number) ?? 0;
  return { balance_cents: balance, bonus_cents: bonus, total_cents: balance + bonus };
}

/** Deduct credits (transactional — prevents overdraft).
 *  Consumes bonus_cents first, then balance_cents. */
export async function deductCredits(
  userId: string,
  costCents: number,
  meta: {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    description?: string;
  },
): Promise<{ success: boolean; newBalance: number }> {
  const result = await withTx(async (tx) => {
    // Lock the credits row
    const [row] = await tx`
      SELECT balance_cents, bonus_cents FROM credits
      WHERE user_id = ${userId}
      FOR UPDATE
    `;

    const balance = (row?.balance_cents as number) ?? 0;
    const bonus = (row?.bonus_cents as number) ?? 0;
    const total = balance + bonus;

    if (!row || total < costCents) {
      return { success: false, newBalance: balance };
    }

    // Consume bonus first, then balance
    const deductBonus = Math.min(costCents, bonus);
    const deductBalance = costCents - deductBonus;
    const newBalance = balance - deductBalance;
    const newBonus = bonus - deductBonus;

    await tx`
      UPDATE credits
      SET balance_cents = ${newBalance},
          bonus_cents = ${newBonus},
          total_used_cents = total_used_cents + ${costCents},
          updated_at = now()
      WHERE user_id = ${userId}
    `;

    await tx`
      INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents,
        description, model, input_tokens, output_tokens)
      VALUES (${userId}, 'usage', ${-costCents}, ${newBalance + newBonus},
        ${meta.description ?? `${meta.model} via ${meta.provider}`},
        ${meta.model}, ${meta.inputTokens}, ${meta.outputTokens})
    `;

    return { success: true, newBalance };
  });

  return result;
}

/** Add credits (from payment) */
export async function addCredits(
  userId: string,
  amountCents: number,
  paymentRef: string,
  description?: string,
): Promise<number> {
  const result = await withTx(async (tx) => {
    // Check for duplicate payment_ref to prevent double-crediting
    const [existing] = await tx`
      SELECT id FROM transactions
      WHERE payment_ref = ${paymentRef}
    `;
    if (existing) {
      const [row] = await tx`SELECT balance_cents FROM credits WHERE user_id = ${userId}`;
      return (row?.balance_cents as number) ?? 0;
    }

    const [row] = await tx`
      UPDATE credits
      SET balance_cents = balance_cents + ${amountCents},
          total_deposited_cents = total_deposited_cents + ${amountCents},
          updated_at = now()
      WHERE user_id = ${userId}
      RETURNING balance_cents
    `;

    const newBalance = row.balance_cents as number;

    await tx`
      INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents,
        description, payment_ref)
      VALUES (${userId}, 'deposit', ${amountCents}, ${newBalance},
        ${description ?? 'Credit purchase'}, ${paymentRef})
    `;

    return newBalance;
  });

  return result;
}

/** Add bonus credits (referral rewards, subscription welcome, promos).
 *  Bonus credits are consumed before regular balance.
 *  Optional idempotencyKey prevents duplicate bonus if the same key is used twice. */
export async function addBonusCredits(
  userId: string,
  bonusCents: number,
  reason: "referral_welcome" | "referral_earning" | "subscription_welcome" | "promo",
  idempotencyKey?: string,
): Promise<number> {
  const result = await withTx(async (tx) => {
    // Duplicate prevention: check if this bonus was already applied
    if (idempotencyKey) {
      const escapedKey = idempotencyKey.replace(/[%_\\]/g, '\\$&');
      const [existing] = await tx`
        SELECT id FROM transactions
        WHERE user_id = ${userId} AND type = 'bonus' AND description LIKE ${'%[' + escapedKey + ']%'} ESCAPE '\'
      `;
      if (existing) {
        const [current] = await tx`
          SELECT balance_cents, bonus_cents FROM credits WHERE user_id = ${userId}
        `;
        return ((current?.balance_cents as number) ?? 0) + ((current?.bonus_cents as number) ?? 0);
      }
    }

    const [row] = await tx`
      UPDATE credits
      SET bonus_cents = bonus_cents + ${bonusCents},
          updated_at = now()
      WHERE user_id = ${userId}
      RETURNING balance_cents, bonus_cents
    `;

    const newBalance = (row?.balance_cents as number) ?? 0;
    const newBonus = (row?.bonus_cents as number) ?? 0;

    const descriptions: Record<string, string> = {
      referral_welcome: 'Referral welcome bonus',
      referral_earning: 'Referral earnings',
      subscription_welcome: 'Subscription welcome credits',
      promo: 'Promotional bonus',
    };
    const desc = descriptions[reason] + (idempotencyKey ? ` [${idempotencyKey}]` : '');

    await tx`
      INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents, description)
      VALUES (${userId}, 'bonus', ${bonusCents}, ${newBalance + newBonus}, ${desc})
    `;

    return newBalance + newBonus;
  });

  return result;
}

/** Get transaction history */
export async function getTransactions(
  userId: string,
  limit = 50,
  offset = 0,
) {
  const rows = await sql`
    SELECT id, type, amount_cents, balance_after_cents, description,
           model, input_tokens, output_tokens, created_at
    FROM transactions
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    amountCents: r.amount_cents,
    balanceAfterCents: r.balance_after_cents,
    description: r.description,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    createdAt: r.created_at,
  }));
}

/** Record API request for analytics */
export async function recordCloudRequest(
  userId: string,
  model: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  costCents: number,
  latencyMs: number,
  status: string,
) {
  await sql`
    INSERT INTO requests (user_id, model, provider, input_tokens, output_tokens,
      cost_cents, latency_ms, status)
    VALUES (${userId}, ${model}, ${provider}, ${inputTokens}, ${outputTokens},
      ${costCents}, ${latencyMs}, ${status})
  `;
}
