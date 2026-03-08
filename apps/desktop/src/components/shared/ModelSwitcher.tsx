import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, Search } from "lucide-react";
import { api } from "../../lib/api";

interface ModelSwitcherProps {
  value: string;
  onChange: (model: string) => void;
  compact?: boolean;
}

export const ModelSwitcher: React.FC<ModelSwitcherProps> = ({ value, onChange, compact }) => {
  const [models, setModels] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchModels = useCallback(() => {
    api.getModels().then((res) => {
      const ids = new Set<string>();
      for (const p of res.providers) {
        if (!p.active) continue;
        for (const m of p.models) ids.add(m.id);
      }
      setModels([...ids].sort());
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Re-fetch when opening dropdown
  useEffect(() => {
    if (open) {
      fetchModels();
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setSearch("");
    }
  }, [open, fetchModels]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = search
    ? models.filter((id) => id.toLowerCase().includes(search.toLowerCase()))
    : models;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: compact ? "4px 10px" : "5px 12px",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          color: "var(--color-text-primary)",
          fontSize: compact ? 11 : 12,
          fontWeight: 500,
          cursor: "pointer",
          transition: "all 0.15s ease",
        }}
      >
        <span style={{ fontFamily: "'SF Mono', Menlo, monospace", letterSpacing: -0.3 }}>
          {value || "Select model"}
        </span>
        <ChevronDown
          size={compact ? 11 : 13}
          style={{
            opacity: 0.4,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "var(--color-bg-card)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            zIndex: 200,
            width: 280,
            maxHeight: 360,
            display: "flex",
            flexDirection: "column",
            boxShadow: "var(--shadow-elevated)",
            overflow: "hidden",
          }}
        >
          {/* Search */}
          <div style={{ padding: "8px 8px 4px", borderBottom: "1px solid var(--color-border)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 8px",
                background: "var(--color-bg-input)",
                borderRadius: 7,
              }}
            >
              <Search size={12} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--color-text-primary)",
                  fontSize: 12,
                  fontFamily: "inherit",
                }}
              />
            </div>
          </div>

          {/* Model list */}
          <div style={{ flex: 1, overflow: "auto", padding: "4px" }}>
            {filtered.length === 0 && (
              <div style={{ padding: "12px", textAlign: "center", fontSize: 11, color: "var(--color-text-tertiary)" }}>
                No models found
              </div>
            )}
            {filtered.map((id) => (
              <button
                key={id}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  textAlign: "left",
                  padding: "5px 8px",
                  background: id === value ? "var(--color-hover-overlay)" : "transparent",
                  border: "none",
                  borderRadius: 6,
                  color: "var(--color-text-primary)",
                  fontSize: 12,
                  fontFamily: "'SF Mono', Menlo, monospace",
                  letterSpacing: -0.3,
                  cursor: "pointer",
                  transition: "background 0.1s ease",
                }}
                onMouseEnter={(e) => {
                  if (id !== value) (e.target as HTMLElement).style.background = "var(--color-bg-row-hover)";
                }}
                onMouseLeave={(e) => {
                  if (id !== value) (e.target as HTMLElement).style.background = "transparent";
                }}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
