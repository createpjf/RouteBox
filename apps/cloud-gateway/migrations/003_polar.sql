-- Phase 3: Stripe → Polar migration
-- Renames Stripe-specific columns to provider-agnostic / Polar names
-- Idempotent: checks column existence before renaming

DO $$
BEGIN
  -- Users: stripe_customer_id → polar_customer_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'stripe_customer_id') THEN
    ALTER TABLE users RENAME COLUMN stripe_customer_id TO polar_customer_id;
  END IF;

  -- Subscriptions: stripe_subscription_id → polar_subscription_id
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'stripe_subscription_id') THEN
    ALTER TABLE subscriptions RENAME COLUMN stripe_subscription_id TO polar_subscription_id;
  END IF;

  -- Transactions: stripe_session_id → payment_ref (provider-agnostic)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'stripe_session_id') THEN
    ALTER TABLE transactions RENAME COLUMN stripe_session_id TO payment_ref;
  END IF;
END $$;
