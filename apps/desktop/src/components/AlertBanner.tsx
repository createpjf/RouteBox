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
      className="mx-3 mt-2 rounded-xl p-2.5 flex items-start gap-2 animate-slide-in backdrop-blur-xl"
      style={{
        background: "rgba(248, 113, 113, 0.08)",
        border: "0.5px solid rgba(248, 113, 113, 0.15)",
      }}
    >
      <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-accent-red/12 shrink-0">
        <AlertTriangle size={14} strokeWidth={1.75} className="text-accent-red" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        <p className="text-[13px] font-semibold text-accent-red">{title}</p>
        <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">{message}</p>
      </div>
      <button
        onClick={() => {
          setDismissed(true);
          onDismiss();
        }}
        className="flex items-center justify-center h-7 w-7 rounded-lg text-text-tertiary hover:text-text-secondary hover:bg-white/[0.05] transition-colors shrink-0"
      >
        <X size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
