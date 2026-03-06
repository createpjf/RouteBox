// ---------------------------------------------------------------------------
// Credits pre-check middleware — reject if balance too low
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";
import { getBalanceInfo } from "../lib/credits";
import type { CloudEnv } from "../types";

/** Minimum balance in cents to allow a request (covers a moderate API call) */
const MIN_BALANCE_CENTS = 50; // $0.50

/**
 * Pre-check user balance before forwarding to LLM provider.
 * Actual deduction happens after the response completes (in onDone callback).
 */
export async function creditsCheck(c: Context<CloudEnv>, next: Next) {
  const userId = c.get("userId") as string;
  if (!userId) {
    return c.json(
      { error: { message: "Authentication required", type: "auth_error" } },
      401,
    );
  }

  const { total_cents, balance_cents } = await getBalanceInfo(userId);
  if (total_cents < MIN_BALANCE_CENTS) {
    return c.json(
      {
        error: {
          message: "Insufficient credits. Please add credits to continue.",
          type: "billing_error",
          code: "insufficient_credits",
          balance_cents,
          total_cents,
        },
      },
      402,
    );
  }

  await next();
}
