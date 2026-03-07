import { useState, useEffect, useCallback } from "react";
import { Check, Copy, Zap, Cloud } from "lucide-react";
import { ProviderKeyManager } from "./ProviderKeyManager";
import { getGatewayUrl } from "@/lib/constants";

interface OnboardingProps {
  gatewayMode: "local" | "cloud";
  hasProviders: boolean;
  authToken: string;
  onDismiss: () => void;
}

type LocalStep = 1 | 2;

export function Onboarding({ gatewayMode, hasProviders, authToken, onDismiss }: OnboardingProps) {
  const [step, setStep] = useState<LocalStep>(1);
  const [copiedField, setCopiedField] = useState<"url" | "token" | "curl" | null>(null);
  const [tokenTimeout, setTokenTimeout] = useState(false);

  // Auto-advance step 1 → 2 when providers configured (local only)
  useEffect(() => {
    if (gatewayMode === "local" && step === 1 && hasProviders) {
      const timer = setTimeout(() => setStep(2), 600);
      return () => clearTimeout(timer);
    }
  }, [gatewayMode, step, hasProviders]);

  // Show error if token hasn't appeared within 6s on step 2
  useEffect(() => {
    if (!authToken && step === 2) {
      const t = setTimeout(() => setTokenTimeout(true), 6000);
      return () => clearTimeout(t);
    }
    setTokenTimeout(false);
  }, [authToken, step]);

  const handleCopy = useCallback((text: string, field: "url" | "token" | "curl") => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    });
  }, []);

  const gatewayUrl = getGatewayUrl();

  // Cloud mode: single confirmation page
  if (gatewayMode === "cloud") {
    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-bg-panel">
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-6">
          <CloudConfirmation onDismiss={onDismiss} />
        </div>
      </div>
    );
  }

  // Local mode: 2-step flow
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-bg-panel">
      <div className="flex-1 flex flex-col px-8 py-6 overflow-y-auto">
        {/* Progress dots — 2 for local */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                s === step
                  ? "bg-text-primary w-5"
                  : s < step
                    ? "bg-accent-green"
                    : "bg-text-tertiary/30"
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 flex flex-col items-center justify-center animate-page-in" key={step}>
          {step === 1 && <StepProviders />}
          {step === 2 && (
            <StepReady
              gatewayUrl={gatewayUrl}
              authToken={authToken}
              tokenTimeout={tokenTimeout}
              copiedField={copiedField}
              onCopy={handleCopy}
              onDismiss={onDismiss}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CloudConfirmation({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-5 w-full max-w-xs">
      <div className="w-14 h-14 rounded-2xl bg-[#007AFF]/10 border border-[#007AFF]/20 flex items-center justify-center">
        <Cloud size={28} strokeWidth={1.75} className="text-[#007AFF]" />
      </div>

      <div>
        <h2 className="text-[18px] font-semibold text-text-primary mb-1">
          RouteBox Cloud
        </h2>
        <p className="text-[13px] text-text-secondary leading-relaxed">
          Sign in to your RouteBox Cloud account to start routing requests — no API keys needed.
        </p>
      </div>

      <div className="w-full glass-card-static p-3 text-left space-y-2">
        {[
          "No API keys required",
          "Pay as you go with credits",
          "Route across multiple AI models",
        ].map((bullet) => (
          <div key={bullet} className="flex items-center gap-2">
            <Check size={12} strokeWidth={2.5} className="text-accent-green shrink-0" />
            <p className="text-[12px] text-text-secondary">{bullet}</p>
          </div>
        ))}
      </div>

      <p className="text-[12px] text-text-tertiary leading-relaxed">
        Go to the <span className="font-medium text-text-secondary">Activity</span> tab to sign in to your cloud account.
      </p>

      <p className="text-[11px] text-text-tertiary leading-relaxed text-center">
        Your gateway endpoint and API key are shown in the{" "}
        <span className="font-medium text-text-secondary">Activity</span>{" "}
        tab after signing in.
      </p>

      <button
        onClick={onDismiss}
        className="btn-primary w-full !h-10 !text-[14px]"
      >
        Got It
      </button>
    </div>
  );
}

function StepProviders() {
  return (
    <div className="flex flex-col items-center w-full gap-4">
      <div className="text-center">
        <h2 className="text-[18px] font-semibold text-text-primary mb-1">
          Add Your First Provider
        </h2>
        <p className="text-[13px] text-text-secondary leading-relaxed">
          Connect an AI provider to start routing requests
        </p>
      </div>
      <div className="w-full">
        <ProviderKeyManager />
      </div>
    </div>
  );
}

function CopyButton({ copied, onCopy, disabled }: { copied: boolean; onCopy: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onCopy}
      disabled={disabled}
      className="flex items-center gap-1 text-[11px] font-medium text-text-secondary hover:text-text-primary h-7 px-2 rounded-lg hover:bg-bg-input transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {copied ? (
        <>
          <Check size={12} strokeWidth={2} className="text-accent-green" />
          Copied
        </>
      ) : (
        <>
          <Copy size={12} strokeWidth={1.75} />
          Copy
        </>
      )}
    </button>
  );
}

function StepReady({
  gatewayUrl,
  authToken,
  tokenTimeout,
  copiedField,
  onCopy,
  onDismiss,
}: {
  gatewayUrl: string;
  authToken: string;
  tokenTimeout: boolean;
  copiedField: "url" | "token" | "curl" | null;
  onCopy: (text: string, field: "url" | "token" | "curl") => void;
  onDismiss: () => void;
}) {
  const tokenReady = !!authToken;
  const tokenDisplay = authToken
    ? authToken
    : tokenTimeout
      ? "Gateway not ready — check Settings"
      : "Loading…";
  const curlCommand = `curl ${gatewayUrl}/v1/chat/completions \\
  -H "Authorization: Bearer ${authToken || "YOUR_TOKEN"}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello"}]}'`;

  return (
    <div className="flex flex-col items-center text-center gap-4 w-full">
      <div className="w-14 h-14 rounded-2xl bg-accent-green/10 border border-accent-green/20 flex items-center justify-center">
        <Check size={28} strokeWidth={2.5} className="text-accent-green" />
      </div>

      <div>
        <h2 className="text-[18px] font-semibold text-text-primary mb-1">
          You're All Set!
        </h2>
        <p className="text-[13px] text-text-secondary leading-relaxed">
          Point your SDK to the RouteBox gateway
        </p>
      </div>

      {/* Gateway URL */}
      <div className="w-full glass-card-static p-3">
        <label className="block text-[11px] text-text-tertiary font-medium mb-1.5">
          Gateway Endpoint
        </label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-[12px] font-mono text-text-primary bg-bg-input px-2.5 py-1.5 rounded-lg truncate">
            {gatewayUrl}/v1
          </code>
          <CopyButton
            copied={copiedField === "url"}
            onCopy={() => onCopy(`${gatewayUrl}/v1`, "url")}
          />
        </div>
      </div>

      {/* Auth Token */}
      <div className="w-full glass-card-static p-3">
        <label className="block text-[11px] text-text-tertiary font-medium mb-1.5">
          Auth Token
        </label>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-[12px] font-mono text-text-primary bg-bg-input px-2.5 py-1.5 rounded-lg truncate select-all">
            {tokenDisplay}
          </code>
          <CopyButton
            copied={copiedField === "token"}
            onCopy={() => onCopy(authToken, "token")}
            disabled={!tokenReady}
          />
        </div>
        <p className="text-[10px] text-text-tertiary mt-1.5 text-left">
          This token authenticates requests to your local gateway. It's saved in your macOS Keychain.
        </p>
      </div>

      {/* Config snippet */}
      <div className="w-full glass-card-static p-3">
        <label className="block text-[11px] text-text-tertiary font-medium mb-1.5">
          Quick Start — Python
        </label>
        <pre className="text-[11px] font-mono text-text-secondary bg-bg-input p-2.5 rounded-lg overflow-x-auto leading-relaxed">
{`from openai import OpenAI

client = OpenAI(
  base_url="${gatewayUrl}/v1",
  api_key="${tokenDisplay}"
)`}
        </pre>
      </div>

      {/* Curl example */}
      <div className="w-full glass-card-static p-3">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] text-text-tertiary font-medium">
            Test with curl
          </label>
          <CopyButton
            copied={copiedField === "curl"}
            onCopy={() => onCopy(curlCommand, "curl")}
            disabled={!tokenReady}
          />
        </div>
        <pre className="text-[11px] font-mono text-text-secondary bg-bg-input p-2.5 rounded-lg overflow-x-auto leading-relaxed whitespace-pre-wrap break-all">
{curlCommand}
        </pre>
      </div>

      {/* Get started button */}
      <button
        onClick={onDismiss}
        className="btn-primary w-full !h-10 !text-[14px] gap-2"
      >
        <Zap size={16} strokeWidth={2} />
        Get Started
      </button>
    </div>
  );
}
