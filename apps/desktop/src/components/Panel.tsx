import type { ReactNode } from "react";

interface PanelProps {
  children: ReactNode;
}

export function Panel({ children }: PanelProps) {
  return (
    <div className="flex h-screen w-[360px] flex-col overflow-hidden rounded-2xl bg-bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.45),0_8px_24px_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(255,255,255,0.10)]">
      {children}
    </div>
  );
}
