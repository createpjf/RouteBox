import type { ReactNode } from "react";

interface PanelProps {
  children: ReactNode;
}

export function Panel({ children }: PanelProps) {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden panel-gradient">
      {children}
    </div>
  );
}
