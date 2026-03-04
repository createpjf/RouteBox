import React, { useState, useCallback } from "react";
import { Send } from "lucide-react";
import { useStreamChat } from "../../hooks/useStreamChat";
import { MarkdownRenderer } from "../../components/shared/MarkdownRenderer";
import { CostBar } from "../../components/shared/CostBar";
import { ModelSwitcher } from "../../components/shared/ModelSwitcher";

interface CompareModeProps {
  onClose: () => void;
}

interface CompareColumn {
  model: string;
  hook: ReturnType<typeof useStreamChat>;
}

export const CompareMode: React.FC<CompareModeProps> = ({ onClose }) => {
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState(["claude-sonnet-4", "gpt-4o"]);
  const col0 = useStreamChat();
  const col1 = useStreamChat();

  const columns: CompareColumn[] = [
    { model: models[0], hook: col0 },
    { model: models[1], hook: col1 },
  ];

  const handleSend = useCallback(() => {
    if (!prompt.trim()) return;
    const msgs = [{ role: "user" as const, content: prompt }];
    for (const col of columns) {
      col.hook.sendMessage(msgs, col.model);
    }
  }, [prompt, columns]);

  const anyStreaming = columns.some((c) => c.hook.streaming);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 16, gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>Compare Mode</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{
            padding: "4px 10px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            color: "rgba(255,255,255,0.5)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Exit
        </button>
      </div>

      {/* Model selectors */}
      <div style={{ display: "flex", gap: 12 }}>
        {columns.map((col, i) => (
          <div key={i} style={{ flex: 1 }}>
            <ModelSwitcher
              value={col.model}
              onChange={(m) => {
                const next = [...models];
                next[i] = m;
                setModels(next);
              }}
            />
          </div>
        ))}
      </div>

      {/* Prompt input */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="Enter prompt to compare..."
          style={{
            flex: 1,
            padding: "8px 12px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            color: "rgba(255,255,255,0.9)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button
          onClick={handleSend}
          disabled={anyStreaming}
          style={{
            padding: "8px 14px",
            background: "rgba(88,166,255,0.15)",
            border: "none",
            borderRadius: 8,
            color: "#58a6ff",
            cursor: anyStreaming ? "not-allowed" : "pointer",
            opacity: anyStreaming ? 0.5 : 1,
          }}
        >
          <Send size={14} />
        </button>
      </div>

      {/* Response columns */}
      <div style={{ flex: 1, display: "flex", gap: 12, minHeight: 0 }}>
        {columns.map((col, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              background: "rgba(255,255,255,0.03)",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.06)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "6px 10px",
                fontSize: 11,
                fontWeight: 600,
                color: "rgba(255,255,255,0.5)",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {col.model}
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 10 }}>
              {col.hook.streamedText ? (
                <MarkdownRenderer content={col.hook.streamedText} />
              ) : col.hook.streaming ? (
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>Thinking...</span>
              ) : null}
            </div>
            {col.hook.meta && !col.hook.streaming && (
              <div style={{ padding: "4px 10px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <CostBar meta={col.hook.meta} compact />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Cost comparison */}
      {columns.every((c) => c.hook.meta && !c.hook.streaming) && (
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
          {columns.map((col, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center" }}>
              {col.model}: ${col.hook.meta!.cost.toFixed(4)} · {col.hook.meta!.latency_ms}ms
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
