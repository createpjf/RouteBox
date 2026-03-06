// ---------------------------------------------------------------------------
// Polar SDK wrapper — checkout sessions + webhook handling
// ---------------------------------------------------------------------------

import { Polar } from "@polar-sh/sdk";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { sql } from "./db-cloud";

const POLAR_ACCESS_TOKEN = process.env.POLAR_ACCESS_TOKEN;
const POLAR_WEBHOOK_SECRET = process.env.POLAR_WEBHOOK_SECRET;

// Polar instance (lazy init)
let _polar: Polar | null = null;

function getPolar(): Polar {
  if (!_polar) {
    if (!POLAR_ACCESS_TOKEN) throw new Error("POLAR_ACCESS_TOKEN not configured");
    _polar = new Polar({
      accessToken: POLAR_ACCESS_TOKEN,
      server: "production",
    });
  }
  return _polar;
}

// ---------------------------------------------------------------------------
// Credit packages — amount = what user pays, credits = what they get
// ---------------------------------------------------------------------------

export interface CreditPackage {
  id: string;
  polarProductId: string;  // Polar product UUID
  amount: number;      // price in cents (USD)
  credits: number;     // credits added in cents
  label: string;
  bonus?: string;
  isActive?: boolean;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// DB-backed credit packages (replaces hardcoded CREDIT_PACKAGES)
// ---------------------------------------------------------------------------

let _packagesCache: CreditPackage[] | null = null;

export async function loadCreditPackages(): Promise<CreditPackage[]> {
  if (_packagesCache) return _packagesCache;

  try {
    const rows = await sql`
      SELECT id, polar_product_id, amount_cents, credits_cents, label, bonus, is_active, sort_order
      FROM credit_packages
      ORDER BY sort_order, id
    `;
    _packagesCache = rows.map((r) => ({
      id: r.id as string,
      polarProductId: r.polar_product_id as string,
      amount: r.amount_cents as number,
      credits: r.credits_cents as number,
      label: r.label as string,
      bonus: r.bonus as string | undefined,
      isActive: r.is_active as boolean,
      sortOrder: r.sort_order as number,
    }));
  } catch {
    // Fallback to env-var defaults if table not yet migrated
    _packagesCache = [
      {
        id: "credits_5",
        polarProductId: process.env.POLAR_PRODUCT_CREDIT_5 ?? "",
        amount: 500,
        credits: 500,
        label: "$5",
        isActive: true,
        sortOrder: 0,
      },
      {
        id: "credits_20",
        polarProductId: process.env.POLAR_PRODUCT_CREDIT_20 ?? "",
        amount: 2000,
        credits: 2200,
        label: "$20",
        bonus: "+10%",
        isActive: true,
        sortOrder: 1,
      },
    ];
  }
  return _packagesCache;
}

export function reloadCreditPackages(): void {
  _packagesCache = null;
}

// ---------------------------------------------------------------------------
// Subscription plans — three-tier (starter / pro / max) + first-month promos
// ---------------------------------------------------------------------------

export interface SubscriptionPlan {
  id: string;
  polarProductId: string;
  polarProductIdPromo?: string;  // optional first-month discounted product
  label: string;
  monthlyPrice: number;          // price in cents (USD)
  markup: number;                // fallback markup for non-registry models
  includedCreditsCents: number;  // credits issued on activation + renewal
  features: string[];
}

export const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlan> = {
  starter: {
    id: "starter",
    polarProductId: "",
    label: "Starter",
    monthlyPrice: 0,
    markup: 1.08,
    includedCreditsCents: 0,
    features: ["Pay-as-you-go credits", "50 req/min", "Kimi K2.5 (50 req/day)"],
  },
  pro: {
    id: "pro",
    polarProductId: process.env.POLAR_PRO_PRODUCT_ID ?? "",
    polarProductIdPromo: process.env.POLAR_PRO_PROMO_PRODUCT_ID,
    label: "Pro",
    monthlyPrice: 999,
    markup: 1.08,
    includedCreditsCents: 300,   // $3 welcome credits
    features: ["$3 monthly credits", "500 req/min", "All models", "8% markup on non-discount models"],
  },
  max: {
    id: "max",
    polarProductId: process.env.POLAR_MAX_PRODUCT_ID ?? "",
    polarProductIdPromo: process.env.POLAR_MAX_PROMO_PRODUCT_ID,
    label: "Max",
    monthlyPrice: 1999,
    markup: 1.05,
    includedCreditsCents: 800,   // $8 welcome credits
    features: ["$8 monthly credits", "2000 req/min", "Max-exclusive models", "5% markup on non-discount models"],
  },
};

/** Get markup multiplier for a given plan (for legacy non-registry-priced models) */
export function getMarkupForPlan(plan: string): number {
  return SUBSCRIPTION_PLANS[plan]?.markup ?? SUBSCRIPTION_PLANS.starter.markup;
}

// ---------------------------------------------------------------------------
// Create Polar Checkout — credit purchase
// ---------------------------------------------------------------------------

export async function createCheckoutSession(
  userId: string,
  _email: string,
  packageId: string,
) {
  const packages = await loadCreditPackages();
  const pkg = packages.find((p) => p.id === packageId && p.isActive !== false);
  if (!pkg) throw new Error(`Invalid package: ${packageId}`);
  if (!pkg.polarProductId) throw new Error(`Polar product ID not configured for ${packageId}`);

  const polar = getPolar();

  const checkout = await polar.checkouts.create({
    products: [pkg.polarProductId],
    externalCustomerId: userId,
    successUrl: `${process.env.APP_URL ?? "https://routebox.dev"}/billing/success`,
    metadata: {
      userId,
      packageId,
      creditsCents: String(pkg.credits),
    },
  });

  return { url: checkout.url, id: checkout.id };
}

// ---------------------------------------------------------------------------
// Create Polar Checkout — subscription
// ---------------------------------------------------------------------------

export async function createSubscriptionCheckout(
  userId: string,
  _email: string,
  planId: string,
  usePromo = false,
) {
  const plan = SUBSCRIPTION_PLANS[planId];
  if (!plan || planId === "starter") throw new Error(`Invalid subscription plan: ${planId}`);

  const productId = usePromo && plan.polarProductIdPromo
    ? plan.polarProductIdPromo
    : plan.polarProductId;

  if (!productId) throw new Error(`Polar product ID not configured for ${planId}`);

  const polar = getPolar();

  const checkout = await polar.checkouts.create({
    products: [productId],
    externalCustomerId: userId,
    successUrl: `${process.env.APP_URL ?? "https://routebox.dev"}/billing/success`,
    metadata: {
      userId,
      planId,
      usePromo: String(usePromo),
    },
  });

  return { url: checkout.url, id: checkout.id };
}

// ---------------------------------------------------------------------------
// Cancel Polar Subscription
// ---------------------------------------------------------------------------

export async function cancelSubscription(polarSubscriptionId: string) {
  const polar = getPolar();
  return polar.subscriptions.revoke({ id: polarSubscriptionId });
}

// ---------------------------------------------------------------------------
// Verify Polar webhook signature
// ---------------------------------------------------------------------------

export function constructWebhookEvent(
  body: string,
  headers: Record<string, string>,
) {
  if (!POLAR_WEBHOOK_SECRET) throw new Error("POLAR_WEBHOOK_SECRET not configured");
  return validateEvent(body, headers, POLAR_WEBHOOK_SECRET);
}

export { WebhookVerificationError };
