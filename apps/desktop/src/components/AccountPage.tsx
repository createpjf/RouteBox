import { useState, useEffect, useCallback } from "react";
import { Loader2, LogOut, Zap, Copy, Gift, Crown, Wifi, Server, Settings, ArrowRight, Check } from "lucide-react";
import clsx from "clsx";
import {
  getGatewayMode,
  setCloudAuthToken,
  getCloudAuthToken,
} from "@/lib/constants";
import { api, type CloudCreditPackage } from "@/lib/api";
import { ProviderKeyManager } from "./ProviderKeyManager";

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export function AccountPage({ onGoToSettings }: { onGoToSettings?: () => void }) {
  const [mode] = useState(getGatewayMode);
  const isCloud = mode === "cloud";

  const [cloudUser, setCloudUser] = useState<{
    email: string;
    balanceCents: number;
    plan: string;
  } | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudPackages, setCloudPackages] = useState<CloudCreditPackage[]>([]);
  const [cloudReferral, setCloudReferral] = useState<{
    code: string;
    uses: number;
    totalRewardCents: number;
  } | null>(null);
  const [cloudMode, setCloudMode] = useState<"login" | "register">("login");
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [cloudName, setCloudName] = useState("");
  const [cloudReferralCode, setCloudReferralCode] = useState("");
  const [hasCloudToken, setHasCloudToken] = useState(!!getCloudAuthToken());

  // Load cloud state
  useEffect(() => {
    if (!isCloud) return;
    api.cloudGetPackages()
      .then((res) => setCloudPackages(res.packages))
      .catch(() => {});

    if (hasCloudToken) {
      api.cloudGetMe()
        .then((res) => setCloudUser({ email: res.user.email, balanceCents: res.user.balanceCents, plan: res.user.plan }))
        .catch(() => {});
      api.cloudGetReferral()
        .then((res) => setCloudReferral(res))
        .catch(() => {});
    }
  }, [isCloud, hasCloudToken]);

  // Check for stored cloud token on mount
  useEffect(() => {
    tauriInvoke<string>("get_cloud_token")
      .then((t) => { if (t) { setCloudAuthToken(t); setHasCloudToken(true); } })
      .catch(() => {});
  }, []);

  const handleCloudLogin = useCallback(async () => {
    if (!cloudEmail.trim() || !cloudPassword.trim()) return;
    setCloudLoading(true);
    setCloudError(null);
    try {
      const res = await api.cloudLogin(cloudEmail.trim(), cloudPassword);
      await tauriInvoke("store_cloud_token", { token: res.token });
      setCloudAuthToken(res.token);
      setHasCloudToken(true);
      setCloudUser({ email: res.user.email, balanceCents: res.user.balanceCents, plan: res.user.plan });
      setCloudEmail("");
      setCloudPassword("");
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setCloudLoading(false);
    }
  }, [cloudEmail, cloudPassword]);

  const handleCloudRegister = useCallback(async () => {
    if (!cloudEmail.trim() || !cloudPassword.trim()) return;
    setCloudLoading(true);
    setCloudError(null);
    try {
      const res = await api.cloudRegister(
        cloudEmail.trim(),
        cloudPassword,
        cloudName.trim() || undefined,
        cloudReferralCode.trim() || undefined,
      );
      await tauriInvoke("store_cloud_token", { token: res.token });
      setCloudAuthToken(res.token);
      setHasCloudToken(true);
      setCloudUser({ email: res.user.email, balanceCents: res.user.balanceCents, plan: res.user.plan });
      setCloudEmail("");
      setCloudPassword("");
      setCloudName("");
      setCloudReferralCode("");
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setCloudLoading(false);
    }
  }, [cloudEmail, cloudPassword, cloudName, cloudReferralCode]);

  const handleCloudLogout = useCallback(async () => {
    setCloudUser(null);
    setCloudPackages([]);
    setCloudReferral(null);
    setHasCloudToken(false);
    try {
      await tauriInvoke("delete_cloud_token");
    } catch {}
    setCloudAuthToken("");
  }, []);

  const handleRecharge = useCallback(async (packageId: string) => {
    try {
      const res = await api.cloudCreateCheckout(packageId);
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(res.url);
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : "Failed to create checkout");
    }
  }, []);

  const handleUpgradePlan = useCallback(async (planId: string) => {
    try {
      const res = await api.cloudSubscribe(planId);
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(res.url);
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : "Failed to create subscription");
    }
  }, []);

  const handleCopyReferral = useCallback(async () => {
    if (!cloudReferral?.code) return;
    try {
      await navigator.clipboard.writeText(cloudReferral.code);
    } catch {}
  }, [cloudReferral]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-5 pt-2 gap-3">
      {/* Mode Indicator */}
      <div
        className={clsx(
          "flex items-center gap-2 px-3 py-2 rounded-xl",
          isCloud
            ? cloudUser
              ? "bg-[#007AFF]/8"
              : "bg-[#FF9500]/8"
            : "bg-[#34C759]/8",
        )}
      >
        {isCloud ? (
          <Wifi size={14} strokeWidth={1.75} className={cloudUser ? "text-[#007AFF]" : "text-[#FF9500]"} />
        ) : (
          <Server size={14} strokeWidth={1.75} className="text-[#34C759]" />
        )}
        <div className="flex-1 min-w-0">
          <p
            className={clsx(
              "text-[12px] font-semibold",
              isCloud ? (cloudUser ? "text-[#007AFF]" : "text-[#FF9500]") : "text-[#34C759]",
            )}
          >
            {isCloud ? "RouteBox Cloud" : "Local Gateway"}
          </p>
          <p className="text-[10px] text-[#86868B] truncate">
            {isCloud
              ? cloudUser
                ? `${cloudUser.email} · ${cloudUser.plan.charAt(0).toUpperCase() + cloudUser.plan.slice(1)}`
                : "Not signed in"
              : "Running locally"}
          </p>
        </div>
        {onGoToSettings && (
          <button
            onClick={onGoToSettings}
            className="p-1.5 rounded-lg hover:bg-black/5 transition-colors shrink-0"
            title="Open Settings"
          >
            <Settings size={12} strokeWidth={1.75} className="text-[#86868B]" />
          </button>
        )}
      </div>

      {/* Cloud Account Section */}
      {isCloud && (
        <div className="glass-card-static p-3">
          {cloudUser ? (
            <>
              {/* Logged-in state */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[13px] text-[#1D1D1F] font-medium">{cloudUser.email}</p>
                  <p className="text-[10px] text-[#86868B] capitalize">{cloudUser.plan} plan</p>
                </div>
                <button
                  onClick={handleCloudLogout}
                  className="flex items-center gap-1 text-[11px] text-[#86868B] hover:text-accent-red h-7 px-2 rounded-lg hover:bg-accent-red/10 transition-colors"
                >
                  <LogOut size={12} strokeWidth={1.75} />
                  Logout
                </button>
              </div>

              {/* Pro upgrade banner (free users only) */}
              {cloudUser.plan === "free" && (
                <button
                  onClick={() => handleUpgradePlan("pro")}
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

              {/* Plan + Balance */}
              <div className="flex gap-2 mb-3">
                <div className="flex-1 bg-[#F2F2F7] rounded-lg p-2.5">
                  <p className="text-[10px] text-[#86868B] font-medium mb-0.5">Plan</p>
                  <div className="flex items-center gap-1.5">
                    <Crown
                      size={14}
                      strokeWidth={1.75}
                      className={cloudUser.plan === "free" ? "text-[#86868B]" : "text-[#FFD60A]"}
                    />
                    <span className="text-[14px] font-semibold text-[#1D1D1F] capitalize">
                      {cloudUser.plan}
                    </span>
                  </div>
                </div>
                <div className="flex-1 bg-[#F2F2F7] rounded-lg p-2.5">
                  <p className="text-[10px] text-[#86868B] font-medium mb-0.5">Credits</p>
                  <p className="text-[20px] font-semibold text-[#1D1D1F] tabular-nums">
                    ${(cloudUser.balanceCents / 100).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Recharge packages — always shown; skeleton while loading */}
              <div>
                <p className="text-[11px] text-[#86868B] font-medium mb-1.5">Add Credits</p>
                {cloudPackages.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {cloudPackages.map((pkg) => (
                      <button
                        key={pkg.id}
                        onClick={() => handleRecharge(pkg.id)}
                        className="flex flex-col items-center justify-center h-14 rounded-lg border border-[rgba(0,0,0,0.06)] hover:border-[#00e5ff] hover:bg-[#00e5ff]/5 transition-colors"
                      >
                        <span className="text-[13px] font-medium text-[#1D1D1F]">{pkg.label}</span>
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
              <div className="mt-2.5 pt-2.5 border-t border-[rgba(0,0,0,0.05)]">
                <p className="text-[10px] font-semibold text-[#86868B] mb-1.5">How Credits Work</p>
                <p className="text-[10px] text-[#AEAEB2] leading-relaxed">
                  Credits are deducted based on actual AI provider cost, plus a small markup.
                </p>
                <div className="flex gap-2 mt-1.5">
                  <div className="flex-1 bg-[#F2F2F7] rounded-lg p-2 text-center">
                    <p className="text-[9px] text-[#86868B]">Free</p>
                    <p className="text-[12px] font-semibold text-[#1D1D1F]">25%</p>
                    <p className="text-[8px] text-[#AEAEB2]">markup</p>
                  </div>
                  <div className="flex-1 bg-[#F2F2F7] rounded-lg p-2 text-center border border-[#FFD60A]/30">
                    <p className="text-[9px] text-[#86868B]">Pro</p>
                    <p className="text-[12px] font-semibold text-[#1D1D1F]">10%</p>
                    <p className="text-[8px] text-[#AEAEB2]">markup</p>
                  </div>
                </div>
              </div>

              {/* Referral */}
              {cloudReferral && (
                <div className="mt-3 pt-3 border-t border-[rgba(0,0,0,0.06)]">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Gift size={12} strokeWidth={1.75} className="text-[#BF5AF2]" />
                    <p className="text-[11px] text-[#86868B] font-medium">Invite Friends</p>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <code className="flex-1 bg-[#F2F2F7] rounded px-2 py-1.5 text-[13px] text-[#1D1D1F] font-mono tracking-wider text-center select-all">
                      {cloudReferral.code}
                    </code>
                    <button
                      onClick={handleCopyReferral}
                      className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-[#F2F2F7] transition-colors"
                      title="Copy referral code"
                    >
                      <Copy size={12} strokeWidth={1.75} className="text-[#86868B]" />
                    </button>
                  </div>
                  <p className="text-[10px] text-[#86868B]">
                    {cloudReferral.uses} invited · ${(cloudReferral.totalRewardCents / 100).toFixed(2)}{" "}
                    earned
                  </p>
                  <p className="text-[9px] text-[#C7C7CC] mt-0.5">
                    Both you and your friend get $2 when they top up &ge; $5
                  </p>
                </div>
              )}

              {cloudError && <p className="mt-2 text-[10px] text-accent-red">{cloudError}</p>}
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
                    <p className="text-[11px] text-[#86868B]">{bullet}</p>
                  </div>
                ))}
              </div>

              {/* Login / Register form */}
              <div className="flex items-center gap-2 mb-3">
                <Zap size={14} strokeWidth={1.75} className="text-[#00e5ff]" />
                <span className="text-[13px] text-[#1D1D1F] font-medium">
                  {cloudMode === "login" ? "Sign In" : "Create Account"}
                </span>
              </div>

              {cloudMode === "register" && (
                <div className="mb-2">
                  <label className="block text-[11px] text-[#86868B] font-medium mb-1">Name</label>
                  <input
                    type="text"
                    value={cloudName}
                    onChange={(e) => setCloudName(e.target.value)}
                    placeholder="Your name (optional)"
                    className="input"
                  />
                </div>
              )}

              <div className="mb-2">
                <label className="block text-[11px] text-[#86868B] font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={cloudEmail}
                  onChange={(e) => { setCloudEmail(e.target.value); setCloudError(null); }}
                  placeholder="you@example.com"
                  className="input"
                  onKeyDown={(e) => e.key === "Enter" && (cloudMode === "login" ? handleCloudLogin() : handleCloudRegister())}
                />
              </div>

              <div className={cloudMode === "register" ? "mb-2" : "mb-2.5"}>
                <label className="block text-[11px] text-[#86868B] font-medium mb-1">Password</label>
                <input
                  type="password"
                  value={cloudPassword}
                  onChange={(e) => { setCloudPassword(e.target.value); setCloudError(null); }}
                  placeholder="••••••••"
                  className="input"
                  onKeyDown={(e) => e.key === "Enter" && (cloudMode === "login" ? handleCloudLogin() : handleCloudRegister())}
                />
              </div>

              {cloudMode === "register" && (
                <div className="mb-2.5">
                  <label className="block text-[11px] text-[#86868B] font-medium mb-1">Referral Code</label>
                  <input
                    type="text"
                    value={cloudReferralCode}
                    onChange={(e) => setCloudReferralCode(e.target.value)}
                    placeholder="Referral code (optional)"
                    className="input"
                    onKeyDown={(e) => e.key === "Enter" && handleCloudRegister()}
                  />
                </div>
              )}

              {cloudError && <p className="mb-2 text-[10px] text-accent-red">{cloudError}</p>}

              <button
                onClick={cloudMode === "login" ? handleCloudLogin : handleCloudRegister}
                disabled={cloudLoading || !cloudEmail.trim() || !cloudPassword.trim()}
                className={clsx(
                  "w-full h-8 rounded-lg text-[12px] font-medium transition-colors flex items-center justify-center gap-1.5",
                  cloudLoading || !cloudEmail.trim() || !cloudPassword.trim()
                    ? "bg-[#F2F2F7] text-[#86868B] cursor-not-allowed"
                    : "bg-[#00e5ff] text-white hover:bg-[#00e5ff]/90",
                )}
              >
                {cloudLoading && (
                  <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                )}
                {cloudMode === "login" ? "Sign In" : "Create Account"}
              </button>

              <p className="mt-2 text-[10px] text-[#86868B] text-center">
                {cloudMode === "login" ? (
                  <>
                    No account?{" "}
                    <button
                      onClick={() => { setCloudMode("register"); setCloudError(null); }}
                      className="text-[#00e5ff] hover:underline"
                    >
                      Sign up
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button
                      onClick={() => { setCloudMode("login"); setCloudError(null); }}
                      className="text-[#00e5ff] hover:underline"
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>
            </>
          )}
        </div>
      )}

      {/* Local mode: show ProviderKeyManager */}
      {!isCloud && (
        <div>
          <h3 className="text-[13px] font-semibold text-[#1D1D1F] mb-2">
            Your API Keys
          </h3>
          <ProviderKeyManager />
        </div>
      )}

      {/* Try Cloud CTA (local mode only) */}
      {!isCloud && (
        <button
          onClick={onGoToSettings}
          className="glass-card-static p-3 flex items-center gap-3 w-full text-left hover:bg-bg-card/80 transition-colors"
        >
          <div className="w-8 h-8 rounded-lg bg-[#007AFF]/10 flex items-center justify-center shrink-0">
            <Wifi size={14} strokeWidth={1.75} className="text-[#007AFF]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-[#1D1D1F]">Try RouteBox Cloud</p>
            <p className="text-[10px] text-[#86868B]">No API keys needed · Pay per use</p>
          </div>
          <ArrowRight size={14} strokeWidth={1.75} className="text-[#86868B] shrink-0" />
        </button>
      )}
    </div>
  );
}
