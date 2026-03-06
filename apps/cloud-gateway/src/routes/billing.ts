// ---------------------------------------------------------------------------
// Billing routes — packages, checkout, subscriptions, webhook (Polar)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
  CREDIT_PACKAGES,
  SUBSCRIPTION_PLANS,
  createCheckoutSession,
  createSubscriptionCheckout,
  cancelSubscription,
  constructWebhookEvent,
  WebhookVerificationError,
} from "../lib/polar";
import { addCredits } from "../lib/credits";
import { processReferralReward } from "../lib/referrals";
import { sql } from "../lib/db-cloud";
import { log } from "../lib/logger";
import { jwtAuth } from "../middleware/jwt-auth";
import type { CloudEnv } from "../types";

const app = new Hono<CloudEnv>();

// ── GET /packages — public list of credit packages ──────────────────────────

app.get("/packages", (c) => {
  return c.json({
    packages: CREDIT_PACKAGES.map((p) => ({
      id: p.id,
      amount: p.amount,
      credits: p.credits,
      label: p.label,
      bonus: p.bonus,
    })),
  });
});

// ── GET /plans — subscription plans ─────────────────────────────────────────

app.get("/plans", (c) => {
  return c.json({
    plans: Object.values(SUBSCRIPTION_PLANS).map((p) => ({
      id: p.id,
      label: p.label,
      monthlyPrice: p.monthlyPrice,
      markup: p.markup,
      features: p.features,
    })),
  });
});

// ── POST /checkout — create Polar Checkout session (requires JWT) ───────────

app.post("/checkout", jwtAuth, async (c) => {
  const userId = c.get("userId") as string;
  const email = c.get("email") as string;
  const body = await c.req.json<{ packageId: string }>();

  if (!body.packageId) {
    return c.json(
      { error: { message: "packageId is required", type: "validation_error" } },
      400,
    );
  }

  try {
    const session = await createCheckoutSession(userId, email, body.packageId);
    return c.json({ url: session.url, sessionId: session.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json(
      { error: { message: msg, type: "billing_error" } },
      400,
    );
  }
});

// ── POST /subscribe — create Polar Subscription Checkout (requires JWT) ─────

app.post("/subscribe", jwtAuth, async (c) => {
  const userId = c.get("userId") as string;
  const email = c.get("email") as string;
  const body = await c.req.json<{ planId: string }>();

  if (!body.planId) {
    return c.json(
      { error: { message: "planId is required", type: "validation_error" } },
      400,
    );
  }

  try {
    const session = await createSubscriptionCheckout(userId, email, body.planId);
    return c.json({ url: session.url, sessionId: session.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json(
      { error: { message: msg, type: "billing_error" } },
      400,
    );
  }
});

// ── POST /cancel-subscription — cancel subscription (requires JWT) ──────────

app.post("/cancel-subscription", jwtAuth, async (c) => {
  const userId = c.get("userId") as string;

  // Find active subscription
  const [sub] = await sql`
    SELECT polar_subscription_id FROM subscriptions
    WHERE user_id = ${userId} AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `;

  if (!sub?.polar_subscription_id) {
    return c.json(
      { error: { message: "No active subscription found", type: "billing_error" } },
      404,
    );
  }

  try {
    await cancelSubscription(sub.polar_subscription_id as string);

    // Update local status
    await sql`
      UPDATE subscriptions
      SET status = 'canceled', updated_at = now()
      WHERE polar_subscription_id = ${sub.polar_subscription_id as string}
    `;

    return c.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json(
      { error: { message: msg, type: "billing_error" } },
      400,
    );
  }
});

// ── POST /webhook — Polar webhook handler (NO JWT — uses Polar signature) ───

app.post("/webhook", async (c) => {
  const rawBody = await c.req.text();
  const headers = {
    "webhook-id": c.req.header("webhook-id") ?? "",
    "webhook-timestamp": c.req.header("webhook-timestamp") ?? "",
    "webhook-signature": c.req.header("webhook-signature") ?? "",
  };

  if (!headers["webhook-id"] || !headers["webhook-signature"]) {
    return c.json({ error: "Missing webhook signature headers" }, 400);
  }

  try {
    const event = constructWebhookEvent(rawBody, headers);

    // ── Order paid — credit purchase completed ──
    if (event.type === "order.paid") {
      const order = event.data as {
        id: string;
        metadata?: Record<string, string>;
        subscription_id?: string;
      };

      const metadata = order.metadata ?? {};
      const { userId, creditsCents, packageId } = metadata;

      // Credit top-up
      if (userId && creditsCents) {
        const amount = parseInt(creditsCents, 10);
        if (amount > 0) {
          const pkg = CREDIT_PACKAGES.find((p) => p.id === packageId);
          const desc = pkg ? `Credit purchase: ${pkg.label}` : "Credit purchase";
          await addCredits(userId, amount, order.id, desc);
          log.info("credits_added", { userId, amountCents: amount, packageId });

          // Check if this triggers a referral reward
          await processReferralReward(userId).catch((err) => {
            log.error("referral_reward_failed", {
              userId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }
    }

    // ── Subscription created ──
    if (event.type === "subscription.created" || event.type === "subscription.active") {
      const sub = event.data as {
        id: string;
        status: string;
        metadata?: Record<string, string>;
        current_period_start?: string;
        current_period_end?: string;
      };

      const metadata = sub.metadata ?? {};
      const { userId, planId } = metadata;

      if (userId && planId) {
        await sql`
          INSERT INTO subscriptions (user_id, polar_subscription_id, plan, status)
          VALUES (${userId}, ${sub.id}, ${planId}, 'active')
          ON CONFLICT (polar_subscription_id) DO UPDATE
          SET status = 'active', updated_at = now()
        `;
        await sql`
          UPDATE users SET plan = ${planId}, updated_at = now()
          WHERE id = ${userId}
        `;
        log.info("subscription_created", { userId, planId });
      }
    }

    // ── Subscription updated ──
    if (event.type === "subscription.updated") {
      const sub = event.data as {
        id: string;
        status: string;
        current_period_start?: string;
        current_period_end?: string;
      };
      await sql`
        UPDATE subscriptions
        SET status = ${sub.status},
            current_period_start = ${sub.current_period_start ? new Date(sub.current_period_start) : null},
            current_period_end = ${sub.current_period_end ? new Date(sub.current_period_end) : null},
            updated_at = now()
        WHERE polar_subscription_id = ${sub.id}
      `;
    }

    // ── Subscription canceled or revoked ──
    if (event.type === "subscription.canceled" || event.type === "subscription.revoked") {
      const sub = event.data as { id: string };
      const [subRow] = await sql`
        SELECT user_id FROM subscriptions WHERE polar_subscription_id = ${sub.id}
      `;
      if (subRow) {
        await sql`
          UPDATE users SET plan = 'free', updated_at = now()
          WHERE id = ${subRow.user_id as string}
        `;
        await sql`
          UPDATE subscriptions SET status = 'canceled', updated_at = now()
          WHERE polar_subscription_id = ${sub.id}
        `;
        log.info("subscription_ended", { userId: subRow.user_id as string });
      }
    }

    return c.json({ received: true });
  } catch (err: unknown) {
    if (err instanceof WebhookVerificationError) {
      log.error("webhook_verification_failed", { error: err.message });
      return c.json({ error: "Webhook verification failed" }, 400);
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.error("webhook_error", { error: msg });
    return c.json({ error: "Webhook processing error" }, 500);
  }
});

export default app;
