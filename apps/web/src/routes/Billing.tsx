import { useState, useEffect } from "react";
import { CreditCard, ArrowUpRight, CheckCircle } from "lucide-react";
import * as api from "@/lib/api";

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Billing() {
  const [packages, setPackages] = useState<api.CreditPackage[]>([]);
  const [plans, setPlans] = useState<api.SubscriptionPlan[]>([]);
  const [transactions, setTransactions] = useState<{ id: string; type: string; amountCents: number; description: string; createdAt: string }[]>([]);
  const [balance, setBalance] = useState<api.BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getCreditPackages().catch(() => ({ packages: [] })),
      api.getPlans().catch(() => ({ plans: [] })),
      api.getTransactions(1, 10).catch(() => ({ transactions: [], total: 0 })),
      api.getBalance().catch(() => null),
    ]).then(([pkg, pln, txn, bal]) => {
      setPackages(pkg.packages);
      setPlans(pln.plans);
      setTransactions(txn.transactions);
      setBalance(bal);
    }).finally(() => setLoading(false));
  }, []);

  async function handleBuyCredits(packageId: string) {
    setCheckoutLoading(packageId);
    try {
      const res = await api.createCheckout(packageId);
      window.open(res.url, "_blank");
    } catch {
      // error handling
    } finally {
      setCheckoutLoading(null);
    }
  }

  async function handleSubscribe(planId: string) {
    setCheckoutLoading(planId);
    try {
      const res = await api.createSubscription(planId);
      window.open(res.url, "_blank");
    } catch {
      // error handling
    } finally {
      setCheckoutLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-48 skeleton" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-40 skeleton rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Billing</h1>
        <p className="text-text-secondary mt-1">Manage credits and subscription</p>
      </div>

      {/* Current Balance */}
      {balance && (
        <div className="glass-card-static p-6">
          <div className="flex items-center gap-3 mb-2">
            <CreditCard size={20} className="text-accent-ember" />
            <h2 className="text-lg font-semibold text-text-primary">Current Balance</h2>
          </div>
          <div className="text-3xl font-bold text-text-primary">{formatCost(balance.total_cents)}</div>
          {balance.bonus_cents > 0 && (
            <div className="text-sm text-accent-green mt-1">
              Including {formatCost(balance.bonus_cents)} bonus credits
            </div>
          )}
        </div>
      )}

      {/* Credit Packages */}
      {packages.length > 0 && (
        <div>
          <h2 className="section-header">Credit Packages</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {packages.map((pkg) => (
              <div key={pkg.id} className="glass-card-static p-5 flex flex-col">
                <div className="text-lg font-bold text-text-primary">{pkg.name}</div>
                <div className="text-2xl font-bold text-accent-ember mt-2">${pkg.priceUsd}</div>
                <div className="text-sm text-text-secondary mt-1">
                  {pkg.credits} credits
                  {pkg.bonus > 0 && (
                    <span className="text-accent-green ml-1">+{pkg.bonus} bonus</span>
                  )}
                </div>
                <button
                  onClick={() => handleBuyCredits(pkg.id)}
                  className="btn-primary mt-4 text-sm"
                  disabled={checkoutLoading === pkg.id}
                >
                  {checkoutLoading === pkg.id ? "Processing..." : "Buy Now"}
                  <ArrowUpRight size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscription Plans */}
      {plans.length > 0 && (
        <div>
          <h2 className="section-header">Subscription Plans</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <div key={plan.id} className="glass-card-static p-5 flex flex-col">
                <div className="text-lg font-bold text-text-primary capitalize">{plan.name}</div>
                <div className="text-2xl font-bold text-text-primary mt-2">
                  ${plan.priceUsd}<span className="text-sm text-text-secondary font-normal">/mo</span>
                </div>
                {plan.monthlyCredits > 0 && (
                  <div className="text-sm text-accent-green mt-1">
                    ${(plan.monthlyCredits / 100).toFixed(0)} monthly credits included
                  </div>
                )}
                <ul className="mt-3 space-y-1.5 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                      <CheckCircle size={14} className="text-accent-green shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleSubscribe(plan.id)}
                  className="btn-secondary mt-4 text-sm"
                  disabled={checkoutLoading === plan.id}
                >
                  {checkoutLoading === plan.id ? "Processing..." : "Subscribe"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transaction History */}
      <div>
        <h2 className="section-header">Transaction History</h2>
        {transactions.length === 0 ? (
          <div className="glass-card-static p-8 text-center text-text-secondary">No transactions yet.</div>
        ) : (
          <div className="glass-card-static overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-text-tertiary text-xs uppercase tracking-wider">
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
