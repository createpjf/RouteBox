import { useState, useEffect } from "react";
import { ArrowUpRight, CheckCircle, Sparkles, Zap } from "lucide-react";
import * as api from "@/lib/api";

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type Tab = "credits" | "subscription";

export function Billing() {
  const [tab, setTab] = useState<Tab>("credits");
  const [packages, setPackages] = useState<api.CreditPackage[]>([]);
  const [plans, setPlans] = useState<api.SubscriptionPlan[]>([]);
  const [balance, setBalance] = useState<api.BalanceResponse | null>(null);
  const [subscription, setSubscription] = useState<api.SubscriptionInfo | null>(null);
  const [transactions, setTransactions] = useState<{ id: string; type: string; amountCents: number; description: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getCreditPackages().catch(() => ({ packages: [] })),
      api.getPlans().catch(() => ({ plans: [] })),
      api.getBalance().catch(() => null),
      api.getSubscription().catch(() => null),
      api.getTransactions(1, 10).catch(() => ({ transactions: [], total: 0 })),
    ]).then(([pkg, pln, bal, sub, txn]) => {
      setPackages(pkg.packages);
      setPlans(pln.plans);
      setBalance(bal);
      setSubscription(sub);
      setTransactions(txn.transactions);
    }).finally(() => setLoading(false));
  }, []);

  async function handleBuyCredits(packageId: string) {
    setCheckoutLoading(packageId);
    try {
      const res = await api.createCheckout(packageId);
      window.open(res.url, "_blank");
    } catch { /* handled */ } finally {
      setCheckoutLoading(null);
    }
  }

  async function handleSubscribe(planId: string) {
    setCheckoutLoading(planId);
    try {
      const res = await api.createSubscription(planId);
      window.open(res.url, "_blank");
    } catch { /* handled */ } finally {
      setCheckoutLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-24 skeleton rounded-xl" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-48 skeleton rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Balance Banner */}
      <div className="card p-6 flex items-center justify-between">
        <div>
          <div className="text-xs text-text-tertiary uppercase tracking-wider">Current Balance</div>
          <div className="text-3xl font-bold text-text-primary mt-1">
            {balance ? formatCost(balance.total_cents) : "$0.00"}
          </div>
          {balance && balance.bonus_cents > 0 && (
            <div className="text-sm text-accent-green mt-0.5">
              Including {formatCost(balance.bonus_cents)} bonus
            </div>
          )}
        </div>
        {subscription && subscription.plan !== "starter" && (
          <div className="text-right">
            <span className="badge bg-accent-ember/15 text-accent-ember text-sm capitalize">
              {subscription.plan} Plan
            </span>
            <div className="text-xs text-text-tertiary mt-1">
              {subscription.currentPeriodEnd
                ? `Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                : "Active"}
            </div>
          </div>
        )}
      </div>

      {/* Tab Switch */}
      <div className="flex gap-1 bg-bg-card border border-border rounded-xl p-1 w-fit">
        <button
          onClick={() => setTab("credits")}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === "credits" ? "bg-accent-ember text-white" : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <Zap size={16} />
          Pay As You Go
        </button>
        <button
          onClick={() => setTab("subscription")}
          className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === "subscription" ? "bg-accent-ember text-white" : "text-text-secondary hover:text-text-primary"
          }`}
        >
          <Sparkles size={16} />
          Subscription Plans
        </button>
      </div>

      {/* Pay As You Go Panel */}
      {tab === "credits" && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Credit Packages</h2>
            <p className="text-sm text-text-secondary mt-1">
              Top up your balance and pay only for what you use. No monthly commitment.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {packages.map((pkg, i) => {
              const bonusPct = pkg.bonus > 0 ? Math.round((pkg.bonus / pkg.credits) * 100) : 0;
              const isPopular = i === 2; // middle package
              return (
                <div key={pkg.id} className={`card p-5 flex flex-col relative ${isPopular ? "border-accent-ember/30" : ""}`}>
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 badge bg-accent-ember text-white text-xs px-3">
                      Popular
                    </div>
                  )}
                  <div className="text-2xl font-bold text-text-primary">${pkg.priceUsd}</div>
                  <div className="text-sm text-text-secondary mt-1">
                    {pkg.credits} credits
                  </div>
                  {bonusPct > 0 && (
                    <div className="text-sm text-accent-green font-medium mt-1">
                      +{bonusPct}% bonus ({pkg.bonus} extra)
                    </div>
                  )}
                  <button
                    onClick={() => handleBuyCredits(pkg.id)}
                    className={`${isPopular ? "btn-primary" : "btn-secondary"} mt-auto pt-4 text-sm w-full`}
                    disabled={checkoutLoading === pkg.id}
                  >
                    {checkoutLoading === pkg.id ? "..." : "Buy"}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-text-tertiary">
            1 credit = $0.01 USD. Credits never expire. Bonus credits consumed first.
          </p>
        </div>
      )}

      {/* Subscription Plans Panel */}
      {tab === "subscription" && (
        <div className="space-y-6 animate-fade-in">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Subscription Plans</h2>
            <p className="text-sm text-text-secondary mt-1">
              Subscribe for monthly credits, higher rate limits, and lower markup.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Starter (Free) */}
            <div className="card p-6 flex flex-col">
              <div className="text-lg font-bold text-text-primary">Starter</div>
              <div className="text-3xl font-bold text-text-primary mt-2">
                Free
              </div>
              <div className="text-sm text-text-secondary mt-1">Forever</div>

              <ul className="mt-6 space-y-3 flex-1">
                {[
                  "50 req/min rate limit",
                  "Daily model quotas",
                  "1.08x markup",
                  "All models available",
                  "Community support",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-text-secondary">
                    <CheckCircle size={15} className="text-text-tertiary shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-6 text-center text-sm text-text-tertiary">
                {subscription?.plan === "starter" || !subscription ? "Current plan" : ""}
              </div>
            </div>

            {/* Pro */}
            <div className="card p-6 flex flex-col border-accent-ember/30 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 badge bg-accent-ember text-white text-xs px-3">
                Recommended
              </div>
              <div className="text-lg font-bold text-text-primary">Pro</div>
              <div className="text-3xl font-bold text-text-primary mt-2">
                $9.99<span className="text-sm text-text-secondary font-normal">/mo</span>
              </div>
              <div className="text-sm text-accent-green mt-1">$3 monthly credits included</div>

              <ul className="mt-6 space-y-3 flex-1">
                {[
                  "500 req/min rate limit",
                  "No daily quotas",
                  "1.08x markup",
                  "$3 credits every month",
                  "Priority support",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-text-secondary">
                    <CheckCircle size={15} className="text-accent-green shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              {subscription?.plan === "pro" ? (
                <div className="mt-6 text-center text-sm text-accent-ember font-medium">Current plan</div>
              ) : (
                <button
                  onClick={() => plans[1] && handleSubscribe(plans[1].id)}
                  className="btn-primary mt-6 w-full text-sm"
                  disabled={!!checkoutLoading}
                >
                  Upgrade to Pro
                </button>
              )}
            </div>

            {/* Max */}
            <div className="card p-6 flex flex-col">
              <div className="text-lg font-bold text-text-primary">Max</div>
              <div className="text-3xl font-bold text-text-primary mt-2">
                $19.99<span className="text-sm text-text-secondary font-normal">/mo</span>
              </div>
              <div className="text-sm text-accent-green mt-1">$8 monthly credits included</div>

              <ul className="mt-6 space-y-3 flex-1">
                {[
                  "2,000 req/min rate limit",
                  "No daily quotas",
                  "1.05x markup (lower!)",
                  "$8 credits every month",
                  "Priority support",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-text-secondary">
                    <CheckCircle size={15} className="text-accent-green shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              {subscription?.plan === "max" ? (
                <div className="mt-6 text-center text-sm text-accent-ember font-medium">Current plan</div>
              ) : (
                <button
                  onClick={() => plans[2] && handleSubscribe(plans[2].id)}
                  className="btn-secondary mt-6 w-full text-sm"
                  disabled={!!checkoutLoading}
                >
                  Upgrade to Max
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Transaction History */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-text-primary mb-4">Transaction History</h2>
        {transactions.length === 0 ? (
          <div className="text-center py-6 text-text-secondary text-sm">No transactions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-tertiary text-xs">
                  <th className="text-left px-4 py-3 font-semibold">Date</th>
                  <th className="text-left px-4 py-3 font-semibold">Description</th>
                  <th className="text-left px-4 py-3 font-semibold">Type</th>
                  <th className="text-right px-4 py-3 font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-border-light hover:bg-bg-row-hover transition-colors">
                    <td className="px-4 py-3 text-text-secondary text-xs">
                      {new Date(tx.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-text-primary">{tx.description}</td>
                    <td className="px-4 py-3">
                      <span className={`badge ${tx.type === "credit" ? "bg-accent-green/15 text-accent-green" : "bg-accent-red/15 text-accent-red"}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${tx.amountCents >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                      {tx.amountCents >= 0 ? "+" : ""}{formatCost(tx.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
