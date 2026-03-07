import { useState, useRef, useEffect } from "react";
import { Search, XCircle } from "lucide-react";
import type { RequestLogEntry } from "@/types/stats";

const STATUS_BADGE = {
  success: { bg: "rgba(52,199,89,0.12)", color: "#34C759", label: "OK" },
  error: { bg: "rgba(255,59,48,0.12)", color: "#FF3B30", label: "ERR" },
  fallback: { bg: "rgba(255,159,10,0.12)", color: "#FF9F0A", label: "FB" },
} as const;

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

interface ActivityPageProps {
  requestLog: RequestLogEntry[];
  onSelectEntry?: (entry: RequestLogEntry) => void;
}

export function ActivityPage({ requestLog, onSelectEntry }: ActivityPageProps) {
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const filtered = search
    ? requestLog.filter((e) => e.model.toLowerCase().includes(search.toLowerCase()))
    : requestLog;

  useEffect(() => {
    if (autoScroll.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filtered]);

  function handleScroll() {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 30;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 p-5 pt-2 gap-3">
      {/* Search filter */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ background: "var(--color-bg-elevated)", borderRadius: 10, border: "1px solid var(--color-border)" }}>
        <Search size={14} strokeWidth={1.75} className="text-text-tertiary shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter requests..."
          className="bg-transparent outline-none flex-1 text-[13px] text-text-primary placeholder:text-text-tertiary"
          style={{ caretColor: "var(--color-text-primary)" }}
        />
        {search && (
          <button onClick={() => setSearch("")} className="shrink-0">
            <XCircle size={14} strokeWidth={1.75} className="text-text-tertiary" />
          </button>
        )}
      </div>

      {/* Request Log — fills remaining space */}
      {filtered.length === 0 ? (
        <div className="glass-card-static flex items-center justify-center flex-1">
          <p className="text-[11px] text-text-tertiary">
            {search ? "No matching requests" : "Waiting for requests..."}
          </p>
        </div>
      ) : (
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex flex-col gap-2 flex-1 overflow-y-auto min-h-0"
          style={{ scrollbarWidth: "none" }}
        >
          {filtered.map((entry) => {
            const badge = STATUS_BADGE[entry.status];
            return (
              <div
                key={entry.id}
                className="glass-card px-3.5 py-3 cursor-pointer"
                onClick={() => onSelectEntry?.(entry)}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono text-text-tertiary">
                      {formatTime(entry.timestamp)}
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-text-primary">
                      POST
                    </span>
                    <span className="text-[11px] font-mono text-text-tertiary truncate">
                      /v1/chat/completions
                    </span>
                  </div>
                  <span
                    className="text-[11px] font-mono font-semibold px-1.5 py-px rounded-[5px] shrink-0 ml-2"
                    style={{ background: badge.bg, color: badge.color }}
                  >
                    {badge.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-text-primary">
                    {entry.provider}
                  </span>
                  <span className="text-[11px] text-text-tertiary">
                    {entry.model}
                  </span>
                  <span className="flex-1" />
                  <span className="text-[11px] font-mono text-text-tertiary">
                    {formatLatency(entry.latencyMs)}
                  </span>
                  <span className="text-[11px] font-mono text-text-tertiary">
                    {entry.tokens > 0 ? `${entry.tokens} tok` : "\u2014"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
