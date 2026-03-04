import React, { useState, useEffect, useRef, useCallback } from "react";
import { Send, Square, Columns, MessageSquare, Globe } from "lucide-react";
import { useStreamChat } from "../hooks/useStreamChat";
import { ModelSwitcher } from "../components/shared/ModelSwitcher";
import { CostBar } from "../components/shared/CostBar";
import { MarkdownRenderer } from "../components/shared/MarkdownRenderer";
import { ChatSidebar } from "./chat/ChatSidebar";
import { api } from "../lib/api";
import type { ConversationSummary, MessageResponse } from "../lib/api";
import type { RouteboxMeta } from "../types/chat";

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  provider?: string;
  cost?: number;
  latency_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
}

export const ChatWindow: React.FC = () => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState("claude-sonnet-4");
  const [compareMode, setCompareMode] = useState(false);
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [searchOn, setSearchOn] = useState(false);
  const { streaming, streamedText, meta, sendMessage, abort } = useStreamChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      const res = await api.getConversations();
      setConversations(res.conversations);
    } catch {}
  }, []);

  useEffect(() => {
    loadConversations();
    api.getSearchStatus().then((s) => setSearchEnabled(s.enabled)).catch(() => {});
  }, [loadConversations]);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    api.getConversation(activeConvId).then((conv) => {
      setMessages(
        conv.messages.map((m: MessageResponse) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          model: m.model,
          provider: m.provider,
          cost: m.cost,
          latency_ms: m.latency_ms,
          input_tokens: m.input_tokens,
          output_tokens: m.output_tokens,
        })),
      );
      if (conv.model) setModel(conv.model);
    }).catch(() => {});
  }, [activeConvId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamedText]);

  // Append streamed response to messages when done
  useEffect(() => {
    if (!streaming && streamedText && meta && activeConvId) {
      api.sendMessage(activeConvId, {
        role: "assistant",
        content: streamedText,
        model: meta.model,
        provider: meta.provider,
        cost: meta.cost,
        inputTokens: meta.usage.prompt_tokens,
        outputTokens: meta.usage.completion_tokens,
        latencyMs: meta.latency_ms,
      }).then((savedMsg) => {
        setMessages((prev) => [
          ...prev,
          {
            id: savedMsg.id,
            role: "assistant",
            content: streamedText,
            model: meta.model,
            provider: meta.provider,
            cost: meta.cost,
            latency_ms: meta.latency_ms,
            input_tokens: meta.usage.prompt_tokens,
            output_tokens: meta.usage.completion_tokens,
          },
        ]);
        loadConversations();
      }).catch(() => {});
    }
  }, [streaming]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  };

  const handleSend = async () => {
    if (!input.trim() || streaming) return;

    let convId = activeConvId;

    if (!convId) {
      try {
        const conv = await api.createConversation(input.slice(0, 50), model);
        convId = conv.id;
        setActiveConvId(conv.id);
        loadConversations();
      } catch {
        return;
      }
    }

    const userMsg = await api.sendMessage(convId, { role: "user", content: input });
    const newUserMsg: DisplayMessage = {
      id: userMsg.id,
      role: "user",
      content: input,
    };
    setMessages((prev) => [...prev, newUserMsg]);

    const history = [...messages, newUserMsg].map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await sendMessage(history, model, searchOn ? { search: true } : undefined);
  };

  const handleNewChat = () => {
    setActiveConvId(null);
    setMessages([]);
    setInput("");
    textareaRef.current?.focus();
  };

  const handleDeleteConversation = async (id: string) => {
    await api.deleteConversation(id);
    if (activeConvId === id) handleNewChat();
    loadConversations();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isEmpty = messages.length === 0 && !streaming;

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100vh",
        background: "#1A1A1C",
        color: "rgba(255,255,255,0.85)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
      }}
    >
      {/* Sidebar */}
      <ChatSidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={setActiveConvId}
        onNew={handleNewChat}
        onDelete={handleDeleteConversation}
      />

      {/* Main chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Header — draggable title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.015)",
            minHeight: 44,
          }}
          data-tauri-drag-region
        >
          <ModelSwitcher value={model} onChange={setModel} />
          <button
            onClick={() => setCompareMode(!compareMode)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              background: compareMode ? "rgba(88,166,255,0.12)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${compareMode ? "rgba(88,166,255,0.2)" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 7,
              color: compareMode ? "#58a6ff" : "rgba(255,255,255,0.4)",
              fontSize: 11,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <Columns size={12} /> Compare
          </button>
        </div>

        {/* Messages area */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "16px 20px",
          }}
        >
          {/* Empty state */}
          {isEmpty && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: 12,
                opacity: 0.4,
              }}
            >
              <MessageSquare size={32} strokeWidth={1.2} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Start a conversation</span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                Select a model and type a message below
              </span>
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Streaming response */}
          {streaming && streamedText && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  padding: "12px 14px",
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 14,
                  maxWidth: "85%",
                }}
              >
                <MarkdownRenderer content={streamedText} />
                <span
                  style={{
                    display: "inline-block",
                    width: 2,
                    height: 14,
                    background: "rgba(255,255,255,0.5)",
                    marginLeft: 2,
                    animation: "pulse 1s infinite",
                  }}
                />
              </div>
            </div>
          )}

          {/* Streaming meta */}
          {!streaming && meta && streamedText && (
            <div style={{ marginBottom: 14, maxWidth: "85%" }}>
              <CostBar meta={meta} />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div
          style={{
            padding: "10px 16px 12px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.015)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-end",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14,
              padding: "4px 4px 4px 10px",
            }}
          >
            {/* Search toggle */}
            {searchEnabled && (
              <button
                onClick={() => setSearchOn(!searchOn)}
                title={searchOn ? "Web search ON" : "Web search OFF"}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  border: "none",
                  background: searchOn ? "rgba(52,199,89,0.15)" : "transparent",
                  color: searchOn ? "#34C759" : "rgba(255,255,255,0.25)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  flexShrink: 0,
                  alignSelf: "flex-end",
                }}
              >
                <Globe size={14} />
              </button>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Send a message..."
              rows={1}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                padding: "8px 0",
                color: "rgba(255,255,255,0.9)",
                fontSize: 13,
                lineHeight: "1.5",
                fontFamily: "inherit",
                resize: "none",
                outline: "none",
                maxHeight: 140,
              }}
            />
            <button
              onClick={() => streaming ? abort() : handleSend()}
              disabled={!streaming && !input.trim()}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 34,
                height: 34,
                borderRadius: 10,
                border: "none",
                background: streaming
                  ? "rgba(255,59,48,0.15)"
                  : input.trim()
                    ? "rgba(88,166,255,0.2)"
                    : "rgba(255,255,255,0.04)",
                color: streaming
                  ? "#FF3B30"
                  : input.trim()
                    ? "#58a6ff"
                    : "rgba(255,255,255,0.2)",
                cursor: streaming || input.trim() ? "pointer" : "default",
                transition: "all 0.15s ease",
                flexShrink: 0,
              }}
            >
              {streaming ? <Square size={14} fill="currentColor" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Inline message bubble component
const MessageBubble: React.FC<{ message: DisplayMessage }> = ({ message }) => {
  const isUser = message.role === "user";
  const metaObj: RouteboxMeta | null =
    !isUser && message.model
      ? {
          object: "routebox.meta",
          provider: message.provider ?? "",
          model: message.model ?? "",
          requested_model: message.model ?? "",
          usage: {
            prompt_tokens: message.input_tokens ?? 0,
            completion_tokens: message.output_tokens ?? 0,
            total_tokens: (message.input_tokens ?? 0) + (message.output_tokens ?? 0),
          },
          cost: message.cost ?? 0,
          latency_ms: message.latency_ms ?? 0,
          is_fallback: false,
        }
      : null;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 14,
      }}
    >
      <div style={{ maxWidth: "85%", display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            padding: "10px 14px",
            borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
            background: isUser
              ? "rgba(88,166,255,0.12)"
              : "rgba(255,255,255,0.03)",
            border: `1px solid ${isUser ? "rgba(88,166,255,0.15)" : "rgba(255,255,255,0.05)"}`,
          }}
        >
          {isUser ? (
            <div style={{ fontSize: 13, lineHeight: "1.5", whiteSpace: "pre-wrap" }}>
              {message.content}
            </div>
          ) : (
            <MarkdownRenderer content={message.content} />
          )}
        </div>
        {metaObj && metaObj.cost > 0 && (
          <CostBar meta={metaObj} compact />
        )}
      </div>
    </div>
  );
};
