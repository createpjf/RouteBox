import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Search, Copy, Check, MessageSquare, ExternalLink, Globe } from "lucide-react";
import { useStreamChat } from "../hooks/useStreamChat";
import { MarkdownRenderer } from "../components/shared/MarkdownRenderer";
import { ModelSwitcher } from "../components/shared/ModelSwitcher";
import { CostBar } from "../components/shared/CostBar";
import { api } from "../lib/api";
import type { SpotlightEntryResponse } from "../lib/api";

export const SpotlightWindow: React.FC = () => {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("claude-sonnet-4");
  const [recents, setRecents] = useState<SpotlightEntryResponse[]>([]);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [searchOn, setSearchOn] = useState(false);
  const { streaming, streamedText, meta, sendMessage, abort } = useStreamChat();
  const inputRef = useRef<HTMLInputElement>(null);
  const hasResponse = streamedText.length > 0;

  // Load recent history + search status
  useEffect(() => {
    api.getSpotlightHistory(3).then((r) => setRecents(r.entries)).catch(() => {});
    api.getSearchStatus().then((s) => setSearchEnabled(s.enabled)).catch(() => {});
  }, []);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Listen for clipboard action events from Tauri
  useEffect(() => {
    const unlisten = listen<{ action: string; text: string }>("spotlight-action", (event) => {
      const { action, text } = event.payload;
      if (!text) return;
      const prefill = action === "translate"
        ? `Translate to English:\n\n${text}`
        : action === "summarize"
          ? `Summarize:\n\n${text}`
          : `Explain:\n\n${text}`;
      setPrompt(prefill);
      // Auto-send
      handleSend(prefill);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [model]);

  const handleSend = useCallback(
    async (overridePrompt?: string) => {
      const text = overridePrompt ?? prompt;
      if (!text.trim() || streaming) return;
      await sendMessage([{ role: "user", content: text }], model, searchOn ? { search: true } : undefined);
    },
    [prompt, model, streaming, sendMessage],
  );

  // Save to spotlight history when response completes
  useEffect(() => {
    if (!streaming && streamedText) {
      api.saveSpotlightEntry({
        prompt,
        response: streamedText,
        model: meta?.model ?? model,
        provider: meta?.provider,
        cost: meta?.cost ?? 0,
        tokens: meta?.usage.total_tokens ?? 0,
        latencyMs: meta?.latency_ms ?? 0,
      }).catch(() => {});
    }
  }, [streaming, streamedText, meta, prompt]);

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(streamedText).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToChat = async () => {
    try {
      const conv = await api.createConversation(prompt.slice(0, 50), model);
      await api.sendMessage(conv.id, { role: "user", content: prompt });
      if (streamedText) {
        await api.sendMessage(conv.id, {
          role: "assistant",
          content: streamedText,
          model: meta?.model,
          provider: meta?.provider,
          cost: meta?.cost,
          inputTokens: meta?.usage.prompt_tokens,
          outputTokens: meta?.usage.completion_tokens,
          latencyMs: meta?.latency_ms,
        });
      }
      invoke("open_chat").catch(() => {});
    } catch {
      // failed
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      invoke("toggle_spotlight").catch(() => {});
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSend();
    }
  };

  return (
    <div
      className="spotlight-gradient spotlight-animate"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: 16,
        userSelect: "none",
      }}
      onKeyDown={handleKeyDown}
    >
      {/* Input row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Search size={16} style={{ color: "rgba(255,255,255,0.4)", flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask anything..."
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "rgba(255,255,255,0.9)",
            fontSize: 15,
            fontFamily: "inherit",
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          onClick={() => streaming ? abort() : handleSend()}
          style={{
            padding: "4px 10px",
            background: streaming ? "rgba(255,59,48,0.2)" : "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            color: "rgba(255,255,255,0.7)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {streaming ? "Stop" : "⌘⏎"}
        </button>
      </div>

      {/* Model switcher + search toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Model:</span>
        <ModelSwitcher value={model} onChange={setModel} compact />
        {searchEnabled && (
          <button
            onClick={() => setSearchOn(!searchOn)}
            title={searchOn ? "Web search ON" : "Web search OFF"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              background: searchOn ? "rgba(52,199,89,0.15)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${searchOn ? "rgba(52,199,89,0.25)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: 6,
              color: searchOn ? "#34C759" : "rgba(255,255,255,0.4)",
              fontSize: 11,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <Globe size={11} /> Web
          </button>
        )}
      </div>

      {/* Response area */}
      {hasResponse && (
        <div
          style={{
            flex: 1,
            marginTop: 12,
            padding: 12,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 10,
            overflow: "auto",
            minHeight: 0,
          }}
        >
          <MarkdownRenderer content={streamedText} />
          {streaming && (
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 14,
                background: "rgba(255,255,255,0.5)",
                animation: "pulse 1s infinite",
                marginLeft: 2,
              }}
            />
          )}
        </div>
      )}

      {/* Cost bar */}
      {meta && !streaming && <CostBar meta={meta} compact />}

      {/* Actions */}
      {hasResponse && !streaming && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={handleCopy} style={{ ...actionBtnStyle, color: copied ? "#34C759" : actionBtnStyle.color }}>
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
          </button>
          <button onClick={handleSaveToChat} style={actionBtnStyle}>
            <MessageSquare size={12} /> Save to Chat
          </button>
          <button
            onClick={() => {
              handleSaveToChat();
            }}
            style={actionBtnStyle}
          >
            <ExternalLink size={12} /> Open Chat
          </button>
        </div>
      )}

      {/* Recents (when no response) */}
      {!hasResponse && recents.length > 0 && (
        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase" }}>
            Recent
          </span>
          <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            {recents.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  setPrompt(r.prompt);
                  inputRef.current?.focus();
                }}
                style={{
                  padding: "3px 8px",
                  background: "rgba(255,255,255,0.06)",
                  border: "none",
                  borderRadius: 6,
                  color: "rgba(255,255,255,0.5)",
                  fontSize: 11,
                  cursor: "pointer",
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {r.prompt.slice(0, 30)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const actionBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 6,
  color: "rgba(255,255,255,0.6)",
  fontSize: 11,
  cursor: "pointer",
};
