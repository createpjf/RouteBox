import { useEffect } from "react";
import { X, CheckCircle, AlertCircle, Info } from "lucide-react";

export interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const colors = {
  success: "text-accent-green",
  error: "text-accent-red",
  info: "text-accent-blue",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const Icon = icons[toast.type];

  return (
    <div className="animate-fade-in glass-card-static flex items-center gap-3 px-4 py-3 min-w-[300px]">
      <Icon size={18} className={colors[toast.type]} />
      <span className="flex-1 text-sm text-text-primary">{toast.message}</span>
      <button onClick={onDismiss} className="text-text-tertiary hover:text-text-primary">
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}
