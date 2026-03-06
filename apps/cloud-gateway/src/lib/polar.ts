// ---------------------------------------------------------------------------
// Polar SDK wrapper — checkout sessions + webhook handling
// ---------------------------------------------------------------------------

import { Polar } from "@polar-sh/sdk";
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";

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
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: "credits_5",
    polarProductId: process.env.POLAR_PRODUCT_CREDIT_5 ?? "",
    amount: 500,
    credits: 500,
    label: "$5",
  },
  {
    id: "credits_20",
    polarProductId: process.env.POLAR_PRODUCT_CREDIT_20 ?? "",
    amount: 2000,
    credits: 2200,
    label: "$20",
    bonus: "+10%",
  },
];

// ---------------------------------------------------------------------------
// Subscription plans — monthly subscriptions with reduced markup
// ---------------------------------------------------------------------------

export interface SubscriptionPlan {
  id: string;
  polarProductId: string;  // Polar product UUID
  label: string;
  monthlyPrice: number;   // price in cents (USD)
  markup: number;          // cost multiplier (1.0 = no markup)
  features: string[];
}

export const SUBSCRIPTION_PLANS: Record<string, SubscriptionPlan> = {
  free: {
    id: "free",
    polarProductId: "",
    label: "Free",
    monthlyPrice: 0,
    markup: 1.25,
    features: ["Pay-as-you-go credits", "25% markup on API costs"],
  },
  pro: {
    id: "pro",
    polarProductId: process.env.POLAR_PRODUCT_PRO ?? "",
    label: "Pro",
    monthlyPrice: 990,     // $9.90/mo
    markup: 1.10,
    features: ["10% markup (save 60%)", "Priority routing", "Usage analytics"],
  },
};

/** Get markup multiplier for a given plan */
export function getMarkupForPlan(plan: string): number {
  return SUBSCRIPTION_PLANS[plan]?.markup ?? SUBSCRIPTION_PLANS.free.markup;
}

// ---------------------------------------------------------------------------
// Create Polar Checkout — credit purchase
// ---------------------------------------------------------------------------

export async function createCheckoutSession(
  userId: string,
  _email: string,
  packageId: string,
) {
  const pkg = CREDIT_PACKAGES.find((p) => p.id === packageId);
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
) {
  const plan = SUBSCRIPTION_PLANS[planId];
  if (!plan || planId === "free") throw new Error(`Invalid subscription plan: ${planId}`);
  if (!plan.polarProductId) throw new Error(`Polar product ID not configured for ${planId}`);

  const polar = getPolar();

  const checkout = await polar.checkouts.create({
    products: [plan.polarProductId],
    externalCustomerId: userId,
    successUrl: `${process.env.APP_URL ?? "https://routebox.dev"}/billing/success`,
    metadata: {
      userId,
      planId,
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
