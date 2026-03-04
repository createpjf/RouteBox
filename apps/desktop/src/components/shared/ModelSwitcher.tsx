import React, { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
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
}

export const ModelSwitcher: React.FC<ModelSwitcherProps> = ({ value, onChange, compact }) => {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.getModels().then((res) => {
      const flat: ModelEntry[] = [];
      for (const p of res.providers) {
        for (const m of p.models) {
          flat.push({ id: m.id, provider: p.provider });
        }
      }
      setModels(flat);
    }).catch(() => {});
  }, []);

  const selected = models.find((m) => m.id === value);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: compact ? "4px 8px" : "6px 12px",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          color: "rgba(255,255,255,0.85)",
          fontSize: compact ? 11 : 13,
          cursor: "pointer",
        }}
      >
        {selected && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: PROVIDER_COLORS[selected.provider] ?? "#888",
            }}
          />
        )}
        <span>{value || "Select model"}</span>
        <ChevronDown size={compact ? 12 : 14} style={{ opacity: 0.5 }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            background: "rgba(30,30,30,0.96)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: 4,
            zIndex: 100,
            maxHeight: 280,
            overflow: "auto",
            minWidth: 200,
          }}
        >
          {/* Group by provider */}
          {Array.from(new Set(models.map((m) => m.provider))).map((provider) => (
            <div key={provider}>
              <div
                style={{
                  padding: "4px 8px",
                  fontSize: 10,
                  color: "rgba(255,255,255,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: PROVIDER_COLORS[provider] ?? "#888",
                    marginRight: 4,
                  }}
                />
                {provider}
              </div>
              {models
                .filter((m) => m.provider === provider)
                .map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 12px",
                      background: m.id === value ? "rgba(255,255,255,0.08)" : "transparent",
                      border: "none",
                      borderRadius: 6,
                      color: "rgba(255,255,255,0.85)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {m.id}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
