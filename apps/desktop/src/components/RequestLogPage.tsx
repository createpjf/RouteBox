import { useState, useRef, useEffect } from "react";
import { Search, XCircle } from "lucide-react";
import type { RequestLogEntry } from "@/types/stats";

interface RequestLogPageProps {
  entries: RequestLogEntry[];
  onSelectEntry?: (entry: RequestLogEntry) => void;
}

const STATUS_BADGE = {
  success: { bg: "rgba(52,199,89,0.08)", color: "#34C759", label: "OK" },
  error: { bg: "rgba(255,59,48,0.08)", color: "#FF3B30", label: "ERR" },
  fallback: { bg: "rgba(255,159,10,0.08)", color: "#FF9F0A", label: "FB" },
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

export function RequestLogPage({ entries, onSelectEntry }: RequestLogPageProps) {
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const filtered = search
    ? entries.filter((e) => e.model.toLowerCase().includes(search.toLowerCase()))
    : entries;

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
    <div className="flex flex-col flex-1 min-h-0 p-5 pt-2 gap-2.5">
      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2 shrink-0" style={{ background: "#F5F5F7", borderRadius: 10 }}>
        <Search size={14} strokeWidth={1.75} className="text-[#C7C7CC] shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter requests..."
          className="bg-transparent outline-none flex-1 text-[13px] text-[#1D1D1F] placeholder:text-[#C7C7CC]"
          style={{ caretColor: "#1D1D1F" }}
        />
        {search && (
          <button onClick={() => setSearch("")} className="shrink-0">
            <XCircle size={14} strokeWidth={1.75} className="text-[#C7C7CC]" />
          </button>
        )}
      </div>

      {/* Log entries */}
      {filtered.length === 0 ? (
        <div className="glass-card-static flex items-center justify-center py-8 flex-1">
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
                    <span className="text-[11px] font-mono text-[#C7C7CC]">
                      {formatTime(entry.timestamp)}
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-[#1D1D1F]">
                      POST
                    </span>
                    <span className="text-[11px] font-mono text-[#AEAEB2] truncate">
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
                  <span className="text-[11px] font-semibold text-[#1D1D1F]">
                    {entry.provider}
                  </span>
                  <span className="text-[11px] text-[#AEAEB2]">
                    {entry.model}
                  </span>
                  <span className="flex-1" />
                  <span className="text-[11px] font-mono text-[#AEAEB2]">
                    {formatLatency(entry.latencyMs)}
                  </span>
                  <span className="text-[11px] font-mono text-[#C7C7CC]">
                    {entry.tokens > 0 ? `${entry.tokens} tok` : "—"}
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
