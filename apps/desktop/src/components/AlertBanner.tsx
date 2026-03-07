import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";

interface AlertBannerProps {
  title: string;
  message: string;
  onDismiss: () => void;
}

export function AlertBanner({ title, message, onDismiss }: AlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      className="mx-4 mt-2 rounded-xl p-2.5 flex items-start gap-2 animate-slide-in border border-border"
      style={{ background: "var(--color-alert-warning-bg, rgba(255,149,0,0.08))" }}
    >
      <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-bg-elevated shrink-0">
        <AlertTriangle size={14} strokeWidth={1.75} className="text-[#FF9500]" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <p className="text-[13px] font-semibold text-text-primary">{title}</p>
        <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">{message}</p>
      </div>
      <button
        onClick={() => {
          setDismissed(true);
          onDismiss();
        }}
        className="flex items-center justify-center h-7 w-7 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-hover-overlay transition-colors shrink-0"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
