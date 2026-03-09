// ---------------------------------------------------------------------------
// Credits pre-check middleware — reject if balance too low
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono";
import { getBalanceInfo } from "../lib/credits";
import type { CloudEnv } from "../types";

/** Minimum balance in cents — absolute floor for any request */
const MIN_BALANCE_CENTS = 1; // $0.01

/** Default estimated cost when model is unknown (conservative) */
const DEFAULT_ESTIMATED_COST_CENTS = 10; // $0.10

/**
 * Rough per-request cost estimates by model prefix (cents).
 * Used for pre-check only — actual billing uses precise token counts.
 */
const MODEL_COST_ESTIMATES: Record<string, number> = {
  "gpt-4o": 5,        // ~$0.05
  "gpt-4": 10,        // ~$0.10
  "gpt-3.5": 1,       // ~$0.01
  "claude-3-5": 5,    // ~$0.05
  "claude-3": 5,      // ~$0.05
  "claude-opus": 30,  // ~$0.30
  "gemini": 2,        // ~$0.02
  "deepseek": 1,      // ~$0.01
  "kimi": 1,          // ~$0.01
  "minimax": 1,       // ~$0.01
};

function estimateCostCents(model: string): number {
  for (const [prefix, cost] of Object.entries(MODEL_COST_ESTIMATES)) {
    if (model.startsWith(prefix)) return cost;
  }
  return DEFAULT_ESTIMATED_COST_CENTS;
}

/**
 * Pre-check user balance before forwarding to LLM provider.
 * Uses model-aware cost estimation instead of a fixed $0.50 floor.
 * Actual deduction happens after the response completes (in onDone callback).
 */
export async function creditsCheck(c: Context<CloudEnv>, next: Next) {
  const userId = c.get("userId") as string;
  if (!userId) {
    return c.json(
      { error: { message: "Authentication required", type: "invalid_request_error", param: null, code: "invalid_api_key" } },
      401,
    );
  }

  const { total_cents, balance_cents } = await getBalanceInfo(userId);

  // Dynamic minimum: estimate cost based on requested model
  let body: { model?: string } | undefined;
  try { body = await c.req.json(); } catch { /* non-JSON body */ }
  const model = body?.model ?? "";
  const minRequired = Math.max(MIN_BALANCE_CENTS, estimateCostCents(model));

  if (total_cents < minRequired) {
    return c.json(
      {
        error: {
          message: "Insufficient credits. Please add credits to continue.",
          type: "billing_error",
          param: null,
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
