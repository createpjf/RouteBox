import { useRef, useEffect } from "react";
import clsx from "clsx";
import { PROVIDER_COLORS } from "@/lib/constants";
import type { RequestLogEntry } from "@/types/stats";

interface RequestLogProps {
  entries: RequestLogEntry[];
}

const STATUS_STYLES = {
  success: "bg-accent-green/10 text-accent-green",
  error: "bg-accent-red/10 text-accent-red",
  fallback: "bg-accent-amber/10 text-accent-amber",
} as const;

export function RequestLog({ entries }: RequestLogProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    if (autoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries]);

  function handleScroll() {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 30;
  }

  if (entries.length === 0) {
    return (
      <div className="glass-card-static rounded-xl p-3">
        <h3 className="section-header">Request Log</h3>
        <p className="text-[11px] text-text-tertiary text-center py-3">Waiting for requests...</p>
      </div>
    );
  }

  return (
    <div className="glass-card-static rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="section-header !mb-0">Request Log</h3>
        <span className="text-[10px] text-text-tertiary tabular-nums">{entries.length} recent</span>
      </div>
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="max-h-[140px] overflow-y-auto space-y-0.5"
      >
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-2 h-8 px-2 rounded-lg hover:bg-bg-row-hover transition-colors"
          >
            <div
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ backgroundColor: PROVIDER_COLORS[entry.provider] || "#3B82F6" }}
            />
            <span className="text-[13px] text-text-primary truncate min-w-0 flex-1 max-w-[140px]">
              {entry.model}
            </span>
            <span className="text-[11px] text-text-tertiary tabular-nums shrink-0">
              {entry.tokens}t
            </span>
            <span className="text-[11px] text-text-tertiary tabular-nums shrink-0 w-10 text-right">
              {entry.latencyMs}ms
            </span>
            <span className={clsx("badge shrink-0", STATUS_STYLES[entry.status])}>
              {entry.status === "success" ? "OK" : entry.status === "error" ? "ERR" : "FB"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
