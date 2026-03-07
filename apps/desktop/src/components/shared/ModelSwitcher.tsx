import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, Search } from "lucide-react";
import { api } from "../../lib/api";
import { PROVIDER_COLORS } from "../../lib/constants";

interface ModelSwitcherProps {
  value: string;
  onChange: (model: string) => void;
  compact?: boolean;
}

interface ModelEntry {
  id: string;
  provider: string;
  active: boolean;
}

export const ModelSwitcher: React.FC<ModelSwitcherProps> = ({ value, onChange, compact }) => {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const fetchModels = useCallback(() => {
    api.getModels().then((res) => {
      const flat: ModelEntry[] = [];
      for (const p of res.providers) {
        if (!p.active) continue; // Only show usable providers
        for (const m of p.models) {
          flat.push({ id: m.id, provider: p.provider, active: p.active });
        }
      }
      setModels(flat);
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

  const selected = models.find((m) => m.id === value);

  const filtered = search
    ? models.filter((m) =>
        m.id.toLowerCase().includes(search.toLowerCase()) ||
        m.provider.toLowerCase().includes(search.toLowerCase())
      )
    : models;
  const filteredProviders = Array.from(new Set(filtered.map((m) => m.provider)));

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
        {selected && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: selected.active
                ? (PROVIDER_COLORS[selected.provider] ?? "#888")
                : "var(--color-dot-offline)",
            }}
          />
        )}
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
            {filteredProviders.length === 0 && (
              <div style={{ padding: "12px", textAlign: "center", fontSize: 11, color: "var(--color-text-tertiary)" }}>
                No models found
              </div>
            )}
            {filteredProviders.map((provider) => {
              const providerModels = filtered.filter((m) => m.provider === provider);
              const color = PROVIDER_COLORS[provider] ?? "#888";

              return (
                <div key={provider} style={{ marginBottom: 2 }}>
                  {/* Provider header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 8px 3px",
                      fontSize: 10,
                      fontWeight: 600,
                      color: "var(--color-text-secondary)",
                      textTransform: "uppercase",
                      letterSpacing: 0.6,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                    {provider}
                  </div>

                  {/* Models */}
                  {providerModels.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        width: "100%",
                        textAlign: "left",
                        padding: "5px 8px 5px 20px",
                        background: m.id === value ? "var(--color-hover-overlay)" : "transparent",
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
                        if (m.id !== value) (e.target as HTMLElement).style.background = "var(--color-bg-row-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (m.id !== value) (e.target as HTMLElement).style.background = "transparent";
                      }}
                    >
                      {m.id}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
