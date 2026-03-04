import React from "react";
import type { RouteboxMeta } from "../../types/chat";

interface CostBarProps {
  meta: RouteboxMeta;
  compact?: boolean;
}

function formatCost(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export const CostBar: React.FC<CostBarProps> = ({ meta, compact }) => {
  const items = [
    meta.model,
    meta.provider,
    `${formatTokens(meta.usage.total_tokens)} tok`,
    formatCost(meta.cost),
    `${meta.latency_ms}ms`,
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 6 : 10,
        fontSize: compact ? 10 : 11,
        color: "rgba(255,255,255,0.45)",
        padding: compact ? "2px 0" : "4px 0",
        flexWrap: "wrap",
      }}
    >
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ opacity: 0.3 }}>·</span>}
          <span>{item}</span>
        </React.Fragment>
      ))}
      {meta.is_fallback && (
        <span style={{ color: "#FFB340", fontSize: compact ? 9 : 10 }}>fallback</span>
      )}
    </div>
  );
};
