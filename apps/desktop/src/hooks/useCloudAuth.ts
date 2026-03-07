import { useState, useEffect, useCallback } from "react";
import {
  getGatewayMode,
  setCloudAuthToken,
  getCloudAuthToken,
} from "@/lib/constants";
import { api, type CloudCreditPackage } from "@/lib/api";

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
    api.cloudGetPackages()
      .then((res) => setCloudPackages(res.packages))
      .catch(() => setPackagesError(true));

    if (hasCloudToken || !!getCloudAuthToken()) {
      api.cloudGetMe()
        .then((res) => setCloudUser({ email: res.user.email, balanceCents: res.user.balanceCents, plan: res.user.plan }))
        .catch(() => {
          setHasCloudToken(false);
          setCloudAuthToken("");
        });
      api.cloudGetReferral()
        .then((res) => setCloudReferral(res))
        .catch(() => setReferralError(true));
    }
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
    } catch {}
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

  const handleCopyReferral = useCallback(async () => {
    if (!cloudReferral?.code) return;
    try {
      await navigator.clipboard.writeText(cloudReferral.code);
    } catch {}
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
    handleRecharge,
    handleUpgradePlan,
    handleCopyReferral,
  };
}
