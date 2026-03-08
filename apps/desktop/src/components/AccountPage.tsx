import { useState, useCallback, useEffect, useRef } from "react";
import { LogOut, Zap, Copy, Gift, Crown, Wifi, Server, ArrowRight, Check, Loader2, Key, Plus, Trash2, Mail } from "lucide-react";
import { api, type CloudApiKey } from "@/lib/api";
import clsx from "clsx";
import {
  getGatewayMode,
} from "@/lib/constants";
import { ProviderKeyManager } from "./ProviderKeyManager";
import { useCloudAuth } from "@/hooks/useCloudAuth";

function CopyRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) { console.warn("Clipboard write failed:", err); }
  }, [value]);
  const display = secret ? (value ? value.slice(0, 8) + "\u2026" : "\u2014") : value;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[10px] text-text-secondary w-14 shrink-0">{label}</span>
      <code className="flex-1 text-[10px] font-mono text-text-primary bg-bg-elevated px-2 py-1 rounded truncate">
        {display}
      </code>
      <button
        onClick={handleCopy}
        className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-hover-overlay transition-colors shrink-0"
        title={`Copy ${label}`}
      >
        {copied
          ? <Check size={11} strokeWidth={2.5} className="text-[#34C759]" />
          : <Copy size={11} strokeWidth={1.75} className="text-text-secondary" />
        }
      </button>
    </div>
  );
}

function CloudApiKeySection() {
  const [keys, setKeys] = useState<CloudApiKey[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => { if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current); }, []);

  const loadKeys = useCallback(async () => {
    try {
      const res = await api.cloudGetApiKeys();
      setKeys(res.apiKeys.filter(k => k.isActive));
    } catch (err) { console.warn("Failed to load API keys:", err); }
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await api.cloudCreateApiKey();
      setNewKey(res.key);
      await loadKeys();
    } catch (err) {
      console.warn("Failed to create API key:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.cloudDeleteApiKey(id);
      await loadKeys();
    } catch (err) { console.warn("Failed to delete API key:", err); }
  };

  const handleCopyNew = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch (err) { console.warn("Clipboard write failed:", err); }
  };

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Key size={12} strokeWidth={1.75} className="text-text-secondary" />
          <p className="text-[11px] text-text-secondary font-medium">API Keys</p>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-1 text-[10px] text-[#ff4d00] hover:text-[#ff6a2a] font-medium disabled:opacity-50"
        >
          {creating ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} strokeWidth={2} />}
          New Key
        </button>
      </div>

      {newKey && (
        <div className="mb-2 p-2 rounded-lg bg-[#34C759]/10 border border-[#34C759]/20">
          <p className="text-[10px] text-[#34C759] font-semibold mb-1">
            New key created — copy it now, it won't be shown again!
          </p>
          <div className="flex items-center gap-1.5">
            <code className="flex-1 text-[10px] font-mono text-text-primary bg-bg-elevated px-2 py-1 rounded truncate select-all">
              {newKey}
            </code>
            <button onClick={handleCopyNew} className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-hover-overlay transition-colors shrink-0">
              {copied
                ? <Check size={11} strokeWidth={2.5} className="text-[#34C759]" />
                : <Copy size={11} strokeWidth={1.75} className="text-text-secondary" />}
            </button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="text-[10px] text-text-tertiary text-center py-2">No API keys yet</p>
      ) : (
        <div className="space-y-1">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-2 py-1 px-2 rounded-lg" style={{ background: "var(--color-bg-row-hover)" }}>
              <code className="flex-1 text-[10px] font-mono text-text-primary truncate">
                {k.keyPrefix}...
              </code>
              <span className="text-[9px] text-text-tertiary shrink-0">{k.name}</span>
              <button
                onClick={() => handleDelete(k.id)}
                className="h-5 w-5 flex items-center justify-center rounded hover:bg-accent-red/10 transition-colors shrink-0"
                title="Delete key"
              >
                <Trash2 size={10} strokeWidth={1.75} className="text-text-tertiary hover:text-accent-red" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface AccountPageProps {
  onCloudLoginSuccess?: () => void;
  gatewayRunningAt?: number;
  onGoToSettings?: () => void;
  showToast?: (msg: string) => void;
}

export function AccountPage({ onCloudLoginSuccess, gatewayRunningAt, onGoToSettings, showToast }: AccountPageProps) {
  const mode = getGatewayMode();
  const isCloud = mode === "cloud";

  const auth = useCloudAuth(onCloudLoginSuccess, showToast);

  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const handleForgotSubmit = useCallback(async () => {
    if (!forgotEmail.trim()) return;
    setForgotSending(true);
    const ok = await auth.handleForgotPassword(forgotEmail.trim());
    setForgotSending(false);
    if (ok) {
      setForgotSent(true);
      showToast?.("If the email exists, a reset link was sent.");
    }
  }, [forgotEmail, auth, showToast]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-5 pt-2 gap-3">
      <h3 className="section-header mb-1">Account</h3>

      {/* Mode Indicator */}
      <div
        className={clsx(
          "flex items-center gap-2 px-3 py-2 rounded-xl",
          isCloud
            ? auth.cloudUser
              ? "bg-[#007AFF]/8"
              : "bg-[#FF9500]/8"
            : "bg-[#34C759]/8",
        )}
      >
        {isCloud ? (
          <Wifi size={14} strokeWidth={1.75} className={auth.cloudUser ? "text-[#007AFF]" : "text-[#FF9500]"} />
        ) : (
          <Server size={14} strokeWidth={1.75} className="text-[#34C759]" />
        )}
        <div className="flex-1 min-w-0">
          <p
            className={clsx(
              "text-[12px] font-semibold",
              isCloud ? (auth.cloudUser ? "text-[#007AFF]" : "text-[#FF9500]") : "text-[#34C759]",
            )}
          >
            {isCloud ? "RouteBox Cloud" : "Local Gateway"}
          </p>
          <p className="text-[10px] text-text-secondary truncate">
            {isCloud
              ? auth.cloudUser
                ? `${auth.cloudUser.email} \u00B7 ${auth.cloudUser.plan.charAt(0).toUpperCase() + auth.cloudUser.plan.slice(1)}`
                : "Not signed in"
              : "Running locally"}
          </p>
        </div>
      </div>

      {/* Cloud Account */}
      {isCloud && (
        <div className="glass-card-static p-3">
          {auth.cloudUser ? (
            <>
              {/* Logged-in state */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[13px] text-text-primary font-medium">{auth.cloudUser.email}</p>
                  <p className="text-[10px] text-text-secondary capitalize">{auth.cloudUser.plan} plan</p>
                </div>
                <button
                  onClick={auth.handleCloudLogout}
                  className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-accent-red h-7 px-2 rounded-lg hover:bg-accent-red/10 transition-colors"
                >
                  <LogOut size={12} strokeWidth={1.75} />
                  Logout
                </button>
              </div>

              {/* Starter → Pro upgrade banner */}
              {auth.cloudUser.plan === "starter" && (
                <button
                  onClick={() => auth.handleUpgradePlan("pro")}
                  className="w-full mb-3 p-3 rounded-xl text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
                  style={{
                    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                    boxShadow: "0 4px 15px rgba(102, 126, 234, 0.3)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Crown size={14} strokeWidth={2} className="text-yellow-300" />
                        <span className="text-[13px] font-bold text-white">Upgrade to Pro</span>
                      </div>
                      <p className="text-[10px] text-white/80">
                        10% markup instead of 25% — save 60% on every request
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[16px] font-bold text-white">$9.90</p>
                      <p className="text-[9px] text-white/70">/month</p>
                    </div>
                  </div>
                </button>
              )}

              {/* Pro → Max upgrade banner */}
              {auth.cloudUser.plan === "pro" && (
                <button
                  onClick={() => auth.handleUpgradePlan("max")}
                  className="w-full mb-3 p-3 rounded-xl text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
                  style={{
                    background: "linear-gradient(135deg, #f7971e 0%, #ffd200 100%)",
                    boxShadow: "0 4px 15px rgba(247, 151, 30, 0.3)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Crown size={14} strokeWidth={2} className="text-white" />
                        <span className="text-[13px] font-bold text-white">Upgrade to Max</span>
                      </div>
                      <p className="text-[10px] text-white/80">
                        5% markup instead of 10% — save 50% more on every request
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[16px] font-bold text-white">$19.99</p>
                      <p className="text-[9px] text-white/70">/month</p>
                    </div>
                  </div>
                </button>
              )}

              {/* Plan + Balance */}
              <div className="flex gap-2 mb-3">
                <div className="flex-1 bg-bg-elevated rounded-lg p-2.5">
                  <p className="text-[10px] text-text-secondary font-medium mb-0.5">Plan</p>
                  <div className="flex items-center gap-1.5">
                    <Crown
                      size={14}
                      strokeWidth={1.75}
                      className={auth.cloudUser.plan === "starter" ? "text-text-secondary" : "text-[#FFD60A]"}
                    />
                    <span className="text-[14px] font-semibold text-text-primary capitalize">
                      {auth.cloudUser.plan}
                    </span>
                  </div>
                </div>
                <div className="flex-1 bg-bg-elevated rounded-lg p-2.5">
                  <p className="text-[10px] text-text-secondary font-medium mb-0.5">Credits</p>
                  <p className="text-[20px] font-semibold text-text-primary tabular-nums">
                    ${(auth.cloudUser.balanceCents / 100).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Connect Your App */}
              <div className="mb-3 p-2.5 rounded-xl" style={{ background: "var(--color-bg-row-hover)" }}>
                <p className="text-[10px] text-text-secondary font-semibold mb-1">Connect Your App</p>
                <CopyRow label="Endpoint" value="https://api.routebox.dev/v1" />
              </div>

              {/* API Keys */}
              <CloudApiKeySection />

              {/* Recharge packages */}
              <div>
                <p className="text-[11px] text-text-secondary font-medium mb-1.5">Add Credits</p>
                {auth.packagesError ? (
                  <p className="text-[10px] text-text-secondary text-center py-3">
                    Failed to load packages —{" "}
                    <button onClick={auth.retryPackages} className="text-[#ff4d00]">retry</button>
                  </p>
                ) : auth.cloudPackages.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {auth.cloudPackages.map((pkg) => (
                      <button
                        key={pkg.id}
                        onClick={() => auth.handleRecharge(pkg.id)}
                        className="flex flex-col items-center justify-center h-14 rounded-lg border border-border hover:border-[#ff4d00] hover:bg-[#ff4d00]/5 transition-colors"
                      >
                        <span className="text-[13px] font-medium text-text-primary">{pkg.label}</span>
                        {pkg.bonus && (
                          <span className="text-[10px] text-[#34C759] font-semibold">{pkg.bonus}</span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-14 rounded-lg skeleton" />
                    ))}
                  </div>
                )}
              </div>

              {/* How Credits Work */}
              <div className="mt-2.5 pt-2.5 border-t border-border-light">
                <p className="text-[10px] font-semibold text-text-secondary mb-1.5">How Credits Work</p>
                <p className="text-[10px] text-text-tertiary leading-relaxed">
                  Credits are deducted based on actual AI provider cost, plus a small markup.
                </p>
                <div className="flex gap-2 mt-1.5">
                  <div className="flex-1 bg-bg-elevated rounded-lg p-2 text-center">
                    <p className="text-[9px] text-text-secondary">Starter</p>
                    <p className="text-[12px] font-semibold text-text-primary">25%</p>
                    <p className="text-[8px] text-text-tertiary">markup</p>
                  </div>
                  <div className="flex-1 bg-bg-elevated rounded-lg p-2 text-center border border-[#FFD60A]/20">
                    <p className="text-[9px] text-text-secondary">Pro</p>
                    <p className="text-[12px] font-semibold text-text-primary">10%</p>
                    <p className="text-[8px] text-text-tertiary">markup</p>
                  </div>
                  <div className="flex-1 bg-bg-elevated rounded-lg p-2 text-center border border-[#BF5AF2]/20">
                    <p className="text-[9px] text-text-secondary">Max</p>
                    <p className="text-[12px] font-semibold text-text-primary">5%</p>
                    <p className="text-[8px] text-text-tertiary">markup</p>
                  </div>
                </div>
              </div>

              {/* Referral */}
              {auth.referralError && (
                <div className="mt-3 pt-3 border-t border-border-light">
                  <p className="text-[10px] text-text-tertiary text-center">
                    Referral program unavailable — try again later
                  </p>
                </div>
              )}
              {auth.cloudReferral && (
                <div className="mt-3 pt-3 border-t border-border-light">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Gift size={12} strokeWidth={1.75} className="text-[#BF5AF2]" />
                    <p className="text-[11px] text-text-secondary font-medium">Invite Friends</p>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <code className="flex-1 bg-bg-elevated rounded px-2 py-1.5 text-[13px] text-text-primary font-mono tracking-wider text-center select-all">
                      {auth.cloudReferral.code}
                    </code>
                    <button
                      onClick={auth.handleCopyReferral}
                      className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-hover-overlay transition-colors"
                      title="Copy referral code"
                    >
                      <Copy size={12} strokeWidth={1.75} className="text-text-secondary" />
                    </button>
                  </div>
                  <p className="text-[10px] text-text-secondary">
                    {auth.cloudReferral.uses} invited · ${(auth.cloudReferral.totalRewardCents / 100).toFixed(2)}{" "}
                    earned
                  </p>
                  <p className="text-[9px] text-text-tertiary mt-0.5">
                    Both you and your friend get $2 when they top up &ge; $5
                  </p>
                </div>
              )}

              {auth.cloudError && <p className="mt-2 text-[10px] text-accent-red">{auth.cloudError}</p>}
            </>
          ) : (
            <>
              {/* Value propositions */}
              <div className="mb-3 space-y-1.5">
                {[
                  "No API keys needed",
                  "Pay as you go with credits",
                  "Route across multiple AI models",
                ].map((bullet) => (
                  <div key={bullet} className="flex items-center gap-2">
                    <Check size={11} strokeWidth={2.5} className="text-[#34C759] shrink-0" />
                    <p className="text-[11px] text-text-secondary">{bullet}</p>
                  </div>
                ))}
              </div>

              {/* Login / Register form */}
              <div className="flex items-center gap-2 mb-3">
                <Zap size={14} strokeWidth={1.75} className="text-[#ff4d00]" />
                <span className="text-[13px] text-text-primary font-medium">
                  {auth.cloudMode === "login" ? "Sign In" : "Create Account"}
                </span>
              </div>

              {auth.cloudMode === "register" && (
                <div className="mb-2">
                  <label className="block text-[11px] text-text-secondary font-medium mb-1">Name</label>
                  <input
                    type="text"
                    value={auth.cloudName}
                    onChange={(e) => auth.setCloudName(e.target.value)}
                    placeholder="Your name (optional)"
                    className="input"
                  />
                </div>
              )}

              <div className="mb-2">
                <label className="block text-[11px] text-text-secondary font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={auth.cloudEmail}
                  onChange={(e) => { auth.setCloudEmail(e.target.value); auth.setCloudError(null); }}
                  placeholder="you@example.com"
                  className="input"
                  onKeyDown={(e) => e.key === "Enter" && (auth.cloudMode === "login" ? auth.handleCloudLogin() : auth.handleCloudRegister())}
                />
              </div>

              <div className={auth.cloudMode === "register" ? "mb-2" : "mb-2.5"}>
                <label className="block text-[11px] text-text-secondary font-medium mb-1">Password</label>
                <input
                  type="password"
                  value={auth.cloudPassword}
                  onChange={(e) => { auth.setCloudPassword(e.target.value); auth.setCloudError(null); }}
                  placeholder={"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
                  className="input"
                  onKeyDown={(e) => e.key === "Enter" && (auth.cloudMode === "login" ? auth.handleCloudLogin() : auth.handleCloudRegister())}
                />
              </div>

              {auth.cloudMode === "register" && (
                <div className="mb-2.5">
                  <label className="block text-[11px] text-text-secondary font-medium mb-1">Referral Code</label>
                  <input
                    type="text"
                    value={auth.cloudReferralCode}
                    onChange={(e) => auth.setCloudReferralCode(e.target.value)}
                    placeholder="Referral code (optional)"
                    className="input"
                    onKeyDown={(e) => e.key === "Enter" && auth.handleCloudRegister()}
                  />
                </div>
              )}

              {auth.cloudError && <p className="mb-2 text-[10px] text-accent-red">{auth.cloudError}</p>}

              <button
                onClick={auth.cloudMode === "login" ? auth.handleCloudLogin : auth.handleCloudRegister}
                disabled={auth.cloudLoading || !auth.cloudEmail.trim() || !auth.cloudPassword.trim()}
                className={clsx(
                  "w-full h-8 rounded-lg text-[12px] font-medium transition-colors flex items-center justify-center gap-1.5",
                  auth.cloudLoading || !auth.cloudEmail.trim() || !auth.cloudPassword.trim()
                    ? "bg-bg-elevated text-text-tertiary cursor-not-allowed"
                    : "bg-[#ff4d00] text-white hover:bg-[#ff6a2a]",
                )}
              >
                {auth.cloudLoading && (
                  <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                )}
                {auth.cloudMode === "login" ? "Sign In" : "Create Account"}
              </button>

              <p className="mt-2 text-[10px] text-text-secondary text-center">
                {auth.cloudMode === "login" ? (
                  <>
                    No account?{" "}
                    <button
                      onClick={() => { auth.setCloudMode("register"); auth.setCloudError(null); }}
                      className="text-[#ff4d00] hover:underline"
                    >
                      Sign up
                    </button>
                    {" · "}
                    <button
                      onClick={() => { setShowForgotPassword(true); setForgotEmail(auth.cloudEmail); setForgotSent(false); }}
                      className="text-text-tertiary hover:text-text-secondary hover:underline"
                    >
                      Forgot Password?
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button
                      onClick={() => { auth.setCloudMode("login"); auth.setCloudError(null); }}
                      className="text-[#ff4d00] hover:underline"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>

              {/* Forgot Password Dialog */}
              {showForgotPassword && (
                <div className="mt-3 p-3 rounded-xl bg-bg-elevated border border-border">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Mail size={12} strokeWidth={1.75} className="text-[#007AFF]" />
                    <p className="text-[11px] text-text-primary font-medium">Reset Password</p>
                  </div>
                  {forgotSent ? (
                    <>
                      <p className="text-[10px] text-[#34C759] mb-2">
                        If an account with that email exists, we've sent a reset link.
                      </p>
                      <button
                        onClick={() => setShowForgotPassword(false)}
                        className="text-[10px] text-text-secondary hover:underline"
                      >
                        Back to login
                      </button>
                    </>
                  ) : (
                    <>
                      <input
                        type="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="input mb-2"
                        onKeyDown={(e) => e.key === "Enter" && handleForgotSubmit()}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleForgotSubmit}
                          disabled={forgotSending || !forgotEmail.trim()}
                          className={clsx(
                            "flex-1 h-7 rounded-lg text-[11px] font-medium transition-colors flex items-center justify-center gap-1",
                            forgotSending || !forgotEmail.trim()
                              ? "bg-bg-elevated text-text-tertiary cursor-not-allowed"
                              : "bg-[#007AFF] text-white hover:bg-[#0062CC]",
                          )}
                        >
                          {forgotSending && <Loader2 size={10} className="animate-spin" />}
                          Send Reset Link
                        </button>
                        <button
                          onClick={() => setShowForgotPassword(false)}
                          className="h-7 px-3 rounded-lg text-[11px] text-text-secondary hover:bg-hover-overlay transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Local mode: ProviderKeyManager */}
      {!isCloud && (
        <div>
          <h3 className="text-[13px] font-semibold text-text-primary mb-2">
            Your API Keys
          </h3>
          <ProviderKeyManager key={gatewayRunningAt} />
        </div>
      )}

      {/* Try Cloud CTA (local mode only) */}
      {!isCloud && (
        <button
          onClick={onGoToSettings}
          className="glass-card-static p-3 flex items-center gap-3 w-full text-left hover:bg-hover-overlay transition-colors mt-2"
        >
          <div className="w-8 h-8 rounded-lg bg-[#007AFF]/10 flex items-center justify-center shrink-0">
            <Wifi size={14} strokeWidth={1.75} className="text-[#007AFF]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-text-primary">Try RouteBox Cloud</p>
            <p className="text-[10px] text-text-secondary">No API keys needed · Pay per use</p>
          </div>
          <ArrowRight size={14} strokeWidth={1.75} className="text-text-secondary shrink-0" />
        </button>
      )}
    </div>
  );
}
