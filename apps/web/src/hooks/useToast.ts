import { useState, useCallback } from "react";
import type { Toast } from "@/components/Toast";

let nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((type: Toast["type"], message: string) => {
    const id = String(++nextId);
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}
