import { X } from "lucide-react";
import clsx from "clsx";
import type { Toast } from "@/hooks/useToast";

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="absolute bottom-12 left-3 right-3 z-50 flex flex-col gap-1.5 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={clsx(
            "flex items-center gap-2 px-3 h-8 rounded-lg text-[11px] font-medium animate-slide-in pointer-events-auto",
            toast.type === "error"
              ? "bg-accent-red/12 text-accent-red border border-accent-red/20"
              : "bg-accent-green/12 text-accent-green border border-accent-green/20"
          )}
        >
          <span className="flex-1 truncate">{toast.message}</span>
          <button
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 text-current opacity-50 hover:opacity-100 transition-opacity"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>
      ))}
    </div>
  );
}
