import { useState, useCallback, useRef, useEffect } from "react";

export interface Toast {
  id: string;
  message: string;
  type: "error" | "success" | "info";
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Clear all pending timers on unmount
  useEffect(() => {
    return () => {
      for (const t of timersRef.current) clearTimeout(t);
    };
  }, []);

  const showToast = useCallback((message: string, type: "error" | "success" | "info" = "error", durationMs = 3000) => {
    const id = `toast_${++counterRef.current}`;
    setToasts((prev) => [...prev.slice(-2), { id, message, type }]);
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, durationMs);
    timersRef.current.add(timer);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}
