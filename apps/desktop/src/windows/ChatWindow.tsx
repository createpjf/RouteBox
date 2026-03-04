import React, { useState, useEffect, useRef, useCallback } from "react";
import { Send, Columns } from "lucide-react";
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
      // Save assistant message to DB
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

  const handleSend = async () => {
    if (!input.trim() || streaming) return;

    let convId = activeConvId;

    // Create new conversation if needed
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

    // Save user message
    const userMsg = await api.sendMessage(convId, { role: "user", content: input });
    const newUserMsg: DisplayMessage = {
      id: userMsg.id,
      role: "user",
      content: input,
    };
    setMessages((prev) => [...prev, newUserMsg]);

    // Build history for API
    const history = [...messages, newUserMsg].map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    setInput("");
    await sendMessage(history, model);
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

  return (
    <div style={{ display: "flex", width: "100%", height: "100vh", background: "#1A1A1C", color: "rgba(255,255,255,0.85)" }}>
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
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
          data-tauri-drag-region
        >
          <ModelSwitcher value={model} onChange={setModel} />
          <button
            onClick={() => setCompareMode(!compareMode)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              background: compareMode ? "rgba(88,166,255,0.15)" : "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6,
              color: compareMode ? "#58a6ff" : "rgba(255,255,255,0.5)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            <Columns size={12} /> Compare
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Streaming response */}
          {streaming && streamedText && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  padding: 12,
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 12,
                  maxWidth: "80%",
                }}
              >
                <MarkdownRenderer content={streamedText} />
                <span style={{ display: "inline-block", width: 6, height: 14, background: "rgba(255,255,255,0.5)", animation: "pulse 1s infinite" }} />
              </div>
            </div>
          )}

          {/* Streaming meta */}
          {!streaming && meta && streamedText && (
            <div style={{ marginBottom: 12, maxWidth: "80%" }}>
              <CostBar meta={meta} />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              style={{
                flex: 1,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
                padding: "10px 14px",
                color: "rgba(255,255,255,0.9)",
                fontSize: 13,
                fontFamily: "inherit",
                resize: "none",
                outline: "none",
                maxHeight: 120,
              }}
            />
            <button
              onClick={() => streaming ? abort() : handleSend()}
              style={{
                padding: "10px 14px",
                background: streaming ? "rgba(255,59,48,0.2)" : "rgba(88,166,255,0.15)",
                border: "none",
                borderRadius: 10,
                color: streaming ? "#FF3B30" : "#58a6ff",
                cursor: "pointer",
              }}
            >
              <Send size={16} />
            </button>
          </div>
        </div>

        {/* Status bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "6px 16px",
            fontSize: 10,
            color: "rgba(255,255,255,0.3)",
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <span>📡 Gateway: ON</span>
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
        marginBottom: 12,
      }}
    >
      <div
        style={{
          maxWidth: "80%",
          padding: 12,
          borderRadius: 12,
          background: isUser ? "rgba(88,166,255,0.12)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${isUser ? "rgba(88,166,255,0.15)" : "rgba(255,255,255,0.06)"}`,
        }}
      >
        {isUser ? (
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{message.content}</div>
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
        {metaObj && metaObj.cost > 0 && (
          <div style={{ marginTop: 6 }}>
            <CostBar meta={metaObj} compact />
          </div>
        )}
      </div>
    </div>
  );
};
