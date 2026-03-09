// ---------------------------------------------------------------------------
// Billing routes — packages, checkout, subscriptions, webhook (Polar)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import {
  loadCreditPackages,
  SUBSCRIPTION_PLANS,
  createCheckoutSession,
  createSubscriptionCheckout,
  cancelSubscription,
  constructWebhookEvent,
  WebhookVerificationError,
} from "../lib/polar";
import { addCredits, addBonusCredits } from "../lib/credits";
import { processReferralReward, claimReferralWelcome } from "../lib/referrals";
import { sql } from "../lib/db-cloud";
import { log } from "../lib/logger";
import { jwtAuth } from "../middleware/jwt-auth";
import type { CloudEnv } from "../types";

const app = new Hono<CloudEnv>();

// ── GET /packages — public list of credit packages ──────────────────────────

app.get("/packages", async (c) => {
  const packages = await loadCreditPackages();
  return c.json({
    packages: packages
      .filter((p) => p.isActive !== false)
      .map((p) => ({
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
      includedCreditsCents: p.includedCreditsCents,
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
  const body = await c.req.json<{ planId: string; usePromo?: boolean }>();

  if (!body.planId) {
    return c.json(
      { error: { message: "planId is required", type: "validation_error" } },
      400,
    );
  }

  try {
    const session = await createSubscriptionCheckout(userId, email, body.planId, body.usePromo ?? false);
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

  if (!headers["webhook-id"] || !headers["webhook-timestamp"] || !headers["webhook-signature"]) {
    return c.json({ error: "Missing webhook signature headers" }, 400);
  }

  try {
    const event = constructWebhookEvent(rawBody, headers);

    // C2: Atomic webhook dedup — INSERT ... ON CONFLICT DO NOTHING + RETURNING
    const webhookId = headers["webhook-id"];
    try {
      const [inserted] = await sql`
        INSERT INTO webhook_events (webhook_id, event_type, payload, status)
        VALUES (${webhookId}, ${event.type}, ${rawBody}, 'processing')
        ON CONFLICT (webhook_id) DO NOTHING
        RETURNING id
      `;
      if (!inserted) {
        log.info("webhook_duplicate_skipped", { webhookId, type: event.type });
        return c.json({ received: true });
      }
    } catch (err) {
      // Table may not exist yet — log and continue (non-blocking)
      log.warn("webhook_event_persist_failed", {
        webhookId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

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
          const allPackages = await loadCreditPackages();
          const pkg = allPackages.find((p) => p.id === packageId);

          // Validate creditsCents matches the expected package amount
          if (pkg && amount !== pkg.credits) {
            log.error("credits_amount_mismatch", {
              orderId: order.id,
              packageId,
              expected: pkg.credits,
              got: amount,
            });
            return c.json({ received: true }, 200);
          }

          const desc = pkg ? `Credit purchase: ${pkg.label}` : "Credit purchase";
          await addCredits(userId, amount, order.id, desc);
          log.info("credits_added", { userId, amountCents: amount, packageId });

          // Check if this triggers a referral welcome bonus (first qualifying deposit)
          await claimReferralWelcome(userId).catch((err) => {
            log.error("referral_welcome_failed", {
              userId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      } else {
        // Missing required metadata — payment received but credits cannot be issued.
        // Return 422 so Polar will retry (in case metadata was lost transiently).
        log.error("order_paid_missing_metadata", {
          orderId: order.id,
          hasUserId: !!userId,
          hasCreditsCents: !!creditsCents,
        });
        return c.json(
          { error: "Missing userId or creditsCents in order metadata" },
          422,
        );
      }
    }

    // ── Subscription created — record subscription + plan, NO credits yet ──
    // (subscription.active will fire next and issue the credits, avoiding double-grant)
    if (event.type === "subscription.created") {
      const sub = event.data as {
        id: string;
        status: string;
        metadata?: Record<string, string>;
      };
      const metadata = (sub.metadata ?? {}) as Record<string, string>;
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

    // ── Subscription active — grant credits (initial activation AND monthly renewal) ──
    // Polar sends this for both initial activation and every renewal cycle.
    // By handling credits here only, we avoid double-grant with subscription.created.
    if (event.type === "subscription.active") {
      const sub = event.data as {
        id: string;
        status: string;
        metadata?: Record<string, string>;
        current_period_start?: string;
        current_period_end?: string;
      };
      const metadata = (sub.metadata ?? {}) as Record<string, string>;
      const { userId, planId } = metadata;

      if (userId && planId) {
        // Check if subscription already existed before this event (= renewal vs initial activation)
        const [existingBefore] = await sql`
          SELECT id FROM subscriptions WHERE polar_subscription_id = ${sub.id}
        `;

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

        // Grant included credits for this billing period (deduplicated via idempotency key)
        const plan = SUBSCRIPTION_PLANS[planId];
        if (plan?.includedCreditsCents > 0) {
          const periodStart = sub.current_period_start
            ? new Date(sub.current_period_start)
            : new Date();
          const periodKey = periodStart.toISOString().slice(0, 7); // "2026-03"
          const idempotencyKey = `sub_welcome_${planId}_${sub.id}_${periodKey}`;
          await addBonusCredits(userId, plan.includedCreditsCents, "subscription_welcome", idempotencyKey).catch((err) => {
            log.error("subscription_credits_failed", {
              userId, planId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
        log.info(existingBefore ? "subscription_renewed" : "subscription_activated", { userId, planId });
      }
    }

    // ── Subscription updated (plan change, status change, renewal) ──
    if (event.type === "subscription.updated") {
      const sub = event.data as {
        id: string;
        status: string;
        metadata?: Record<string, string>;
        current_period_start?: string;
        current_period_end?: string;
      };
      const metadata = (sub.metadata ?? {}) as Record<string, string>;

      await sql`
        UPDATE subscriptions
        SET status = ${sub.status},
            plan = COALESCE(${metadata.planId ?? null}, plan),
            current_period_start = ${sub.current_period_start ? new Date(sub.current_period_start) : null},
            current_period_end = ${sub.current_period_end ? new Date(sub.current_period_end) : null},
            updated_at = now()
        WHERE polar_subscription_id = ${sub.id}
      `;

      // Sync user plan if metadata contains planId
      if (metadata.planId) {
        const [subRow] = await sql`
          SELECT user_id FROM subscriptions WHERE polar_subscription_id = ${sub.id}
        `;
        if (subRow) {
          await sql`
            UPDATE users SET plan = ${metadata.planId}, updated_at = now()
            WHERE id = ${subRow.user_id as string}
          `;
          log.info("subscription_plan_synced", {
            userId: subRow.user_id as string,
            planId: metadata.planId,
            status: sub.status,
          });
        }
      }
    }

    // ── Subscription canceled or revoked ──
    if (event.type === "subscription.canceled" || event.type === "subscription.revoked") {
      const sub = event.data as { id: string };
      const [subRow] = await sql`
        SELECT user_id FROM subscriptions WHERE polar_subscription_id = ${sub.id}
      `;
      if (subRow) {
        await sql`
          UPDATE users SET plan = 'starter', updated_at = now()
          WHERE id = ${subRow.user_id as string}
        `;
        await sql`
          UPDATE subscriptions SET status = 'canceled', updated_at = now()
          WHERE polar_subscription_id = ${sub.id}
        `;
        log.info("subscription_ended", { userId: subRow.user_id as string });
      }
    }

    // Mark webhook event as processed
    try {
      await sql`
        UPDATE webhook_events SET status = 'processed', processed_at = now()
        WHERE webhook_id = ${webhookId}
      `;
    } catch { /* non-blocking */ }

    return c.json({ received: true });
  } catch (err: unknown) {
    if (err instanceof WebhookVerificationError) {
      log.error("webhook_verification_failed", { error: err.message });
      return c.json({ error: "Webhook verification failed" }, 400);
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.error("webhook_error", { error: msg });
    // Mark webhook event as failed
    try {
      await sql`
        UPDATE webhook_events SET status = 'failed', error = ${msg.slice(0, 500)}, processed_at = now()
        WHERE webhook_id = ${headers["webhook-id"]}
      `;
    } catch { /* non-blocking */ }
    return c.json({ error: "Webhook processing error" }, 500);
  }
});

export default app;
