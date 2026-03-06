// ---------------------------------------------------------------------------
// Credits balance management — deposit, deduct, query (transactional)
// ---------------------------------------------------------------------------

import { sql, withTx } from "./db-cloud";

/** Get current balance in cents */
export async function getBalance(userId: string): Promise<number> {
  const [row] = await sql`
    SELECT balance_cents FROM credits WHERE user_id = ${userId}
  `;
  return row?.balance_cents ?? 0;
}

/** Deduct credits (transactional — prevents overdraft) */
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
  // Use a transaction with row-level lock
  const result = await withTx(async (tx) => {
    // Lock the credits row
    const [row] = await tx`
      SELECT balance_cents FROM credits
      WHERE user_id = ${userId}
      FOR UPDATE
    `;

    if (!row || row.balance_cents < costCents) {
      return { success: false, newBalance: (row?.balance_cents as number) ?? 0 };
    }

    const newBalance = (row.balance_cents as number) - costCents;

    // Update balance
    await tx`
      UPDATE credits
      SET balance_cents = ${newBalance},
          total_used_cents = total_used_cents + ${costCents},
          updated_at = now()
      WHERE user_id = ${userId}
    `;

    // Insert transaction record
    await tx`
      INSERT INTO transactions (user_id, type, amount_cents, balance_after_cents,
        description, model, input_tokens, output_tokens)
      VALUES (${userId}, 'usage', ${-costCents}, ${newBalance},
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

    // Update balance
    const [row] = await tx`
      UPDATE credits
      SET balance_cents = balance_cents + ${amountCents},
          total_deposited_cents = total_deposited_cents + ${amountCents},
          updated_at = now()
      WHERE user_id = ${userId}
      RETURNING balance_cents
    `;

    const newBalance = row.balance_cents as number;

    // Insert transaction record
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
