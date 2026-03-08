import { useState, useEffect, useCallback } from "react";
import {
  getGatewayMode,
  setCloudAuthToken,
  getCloudAuthToken,
} from "@/lib/constants";
import { api, ApiError, type CloudCreditPackage } from "@/lib/api";

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export interface CloudUser {
  email: string;
  balanceCents: number;
  plan: string;
}

export interface CloudReferral {
  code: string;
  uses: number;
  totalRewardCents: number;
}

export function useCloudAuth(onLoginSuccess?: () => void, showToast?: (msg: string) => void) {
  const isCloud = getGatewayMode() === "cloud";

  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null);
  const [hasCloudToken, setHasCloudToken] = useState(!!getCloudAuthToken());
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudMode, setCloudMode] = useState<"login" | "register">("login");
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [cloudName, setCloudName] = useState("");
  const [cloudReferralCode, setCloudReferralCode] = useState("");

  // Packages
  const [cloudPackages, setCloudPackages] = useState<CloudCreditPackage[]>([]);
  const [packagesError, setPackagesError] = useState(false);

  // Referral
  const [cloudReferral, setCloudReferral] = useState<CloudReferral | null>(null);
  const [referralError, setReferralError] = useState(false);

  const retryPackages = useCallback(() => {
    setPackagesError(false);
    api.cloudGetPackages()
      .then((res) => setCloudPackages(res.packages))
      .catch(() => setPackagesError(true));
  }, []);

  // Auto-load user + packages when in cloud mode with token
  useEffect(() => {
    if (!isCloud) return;
    let cancelled = false;

    api.cloudGetPackages()
      .then((res) => { if (!cancelled) setCloudPackages(res.packages); })
      .catch((err) => { console.warn("Failed to load packages:", err); if (!cancelled) setPackagesError(true); });

    if (hasCloudToken || !!getCloudAuthToken()) {
      api.cloudGetMe()
        .then((res) => { if (!cancelled) setCloudUser({ email: res.user.email, balanceCents: res.user.balanceCents, plan: res.user.plan }); })
        .catch(async (err) => {
          if (cancelled) return;
          // Only logout on 401 (expired/invalid token), not on network errors
          if (err instanceof ApiError && err.status === 401) {
            setHasCloudToken(false);
            setCloudAuthToken("");
            try { await tauriInvoke("delete_cloud_token"); } catch (e) { console.warn("Failed to delete cloud token:", e); }
          }
        });
      api.cloudGetReferral()
        .then((res) => { if (!cancelled) setCloudReferral(res); })
        .catch((err) => { console.warn("Failed to load referral:", err); if (!cancelled) setReferralError(true); });
    }

    return () => { cancelled = true; };
  }, [isCloud, hasCloudToken]);

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
      onLoginSuccess?.();
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setCloudLoading(false);
    }
  }, [cloudEmail, cloudPassword, onLoginSuccess]);

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
      onLoginSuccess?.();
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setCloudLoading(false);
    }
  }, [cloudEmail, cloudPassword, cloudName, cloudReferralCode, onLoginSuccess]);

  const handleCloudLogout = useCallback(async () => {
    setCloudUser(null);
    setCloudPackages([]);
    setCloudReferral(null);
    setHasCloudToken(false);
    try {
      await tauriInvoke("delete_cloud_token");
    } catch (err) { console.warn("Failed to delete cloud token on logout:", err); }
    setCloudAuthToken("");
  }, []);

  const handleRecharge = useCallback(async (packageId: string) => {
    try {
      const res = await api.cloudCreateCheckout(packageId);
      if (!res.url) throw new Error("No checkout URL returned");
      showToast?.("Opening checkout…");
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(res.url);
      } catch {
        window.open(res.url, "_blank");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create checkout";
      setCloudError(msg);
      showToast?.(msg);
    }
  }, [showToast]);

  const handleUpgradePlan = useCallback(async (planId: string) => {
    try {
      const res = await api.cloudSubscribe(planId);
      if (!res.url) throw new Error("No subscription URL returned");
      showToast?.("Opening checkout…");
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(res.url);
      } catch {
        window.open(res.url, "_blank");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create subscription";
      setCloudError(msg);
      showToast?.(msg);
    }
  }, [showToast]);

  const handleForgotPassword = useCallback(async (email: string) => {
    try {
      await api.cloudForgotPassword(email);
      return true;
    } catch (err) {
      console.warn("Forgot password request failed:", err);
      return false;
    }
  }, []);

  // ── Balance refresh ──────────────────────────────────────────────────────
  const refreshBalance = useCallback(async () => {
    if (!hasCloudToken) return;
    try {
      const res = await api.cloudGetBalance();
      setCloudUser((prev) => prev ? { ...prev, balanceCents: res.total_cents } : prev);
    } catch { /* silent */ }
  }, [hasCloudToken]);

  // Poll balance every 10s when authenticated
  useEffect(() => {
    if (!isCloud || !hasCloudToken) return;
    const timer = setInterval(refreshBalance, 10_000);
    return () => clearInterval(timer);
  }, [isCloud, hasCloudToken, refreshBalance]);

  // Refresh balance on window focus (e.g. returning from checkout)
  useEffect(() => {
    if (!isCloud || !hasCloudToken) return;
    const onFocus = () => refreshBalance();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isCloud, hasCloudToken, refreshBalance]);

  const handleCopyReferral = useCallback(async () => {
    if (!cloudReferral?.code) return;
    try {
      await navigator.clipboard.writeText(cloudReferral.code);
    } catch (err) { console.warn("Clipboard write failed:", err); }
  }, [cloudReferral]);

  return {
    isCloud,
    cloudUser,
    hasCloudToken,
    cloudLoading,
    cloudError,
    setCloudError,
    cloudMode,
    setCloudMode,
    cloudEmail,
    setCloudEmail,
    cloudPassword,
    setCloudPassword,
    cloudName,
    setCloudName,
    cloudReferralCode,
    setCloudReferralCode,
    cloudPackages,
    packagesError,
    retryPackages,
    cloudReferral,
    referralError,
    handleCloudLogin,
    handleCloudRegister,
    handleCloudLogout,
    handleForgotPassword,
    handleRecharge,
    handleUpgradePlan,
    handleCopyReferral,
    refreshBalance,
  };
}
