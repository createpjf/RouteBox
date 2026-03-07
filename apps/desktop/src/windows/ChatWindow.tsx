import React, { useState, useEffect, useRef, useCallback } from "react";
import { Send, Square, Columns, MessageSquare, Globe, Copy, Check, ArrowDown } from "lucide-react";
import clsx from "clsx";
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
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const { streaming, streamedText, meta, sendMessage, abort, clearStream } = useStreamChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
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
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!showScrollBtn) scrollToBottom();
  }, [messages, streamedText, showScrollBtn, scrollToBottom]);

  // Track scroll position for "scroll to bottom" button
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 100);
  }, []);

  // Append streamed response to messages when done
  useEffect(() => {
    if (!streaming && streamedText && activeConvId) {
      api.sendMessage(activeConvId, {
        role: "assistant",
        content: streamedText,
        model: meta?.model ?? model,
        provider: meta?.provider,
        cost: meta?.cost ?? 0,
        inputTokens: meta?.usage.prompt_tokens ?? 0,
        outputTokens: meta?.usage.completion_tokens ?? 0,
        latencyMs: meta?.latency_ms ?? 0,
      }).then((savedMsg) => {
        setMessages((prev) => [
          ...prev,
          {
            id: savedMsg.id,
            role: "assistant",
            content: streamedText,
            model: meta?.model ?? model,
            provider: meta?.provider,
            cost: meta?.cost ?? 0,
            latency_ms: meta?.latency_ms ?? 0,
            input_tokens: meta?.usage.prompt_tokens ?? 0,
            output_tokens: meta?.usage.completion_tokens ?? 0,
          },
        ]);
        loadConversations();
        clearStream();
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
      className="flex w-full h-screen"
      style={{
        background: "var(--color-bg-panel)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-sans)",
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
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header — draggable title bar */}
        <div
          className="flex items-center justify-between px-4 border-b border-border shrink-0"
          style={{ minHeight: 48, background: "var(--color-bg-card)" }}
          data-tauri-drag-region
        >
          <ModelSwitcher value={model} onChange={setModel} />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCompareMode(!compareMode)}
              className={clsx(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all",
                compareMode
                  ? "bg-accent-blue/10 border border-accent-blue/20 text-accent-blue"
                  : "bg-hover-overlay border border-border text-text-tertiary hover:text-text-secondary",
              )}
            >
              <Columns size={12} /> Compare
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto relative"
          style={{ scrollbarWidth: "thin" }}
        >
          <div className="max-w-[720px] mx-auto px-5 py-5">
            {/* Empty state */}
            {isEmpty && (
              <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 animate-fade-in">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{
                    background: "rgba(255, 77, 0, 0.08)",
                    border: "1px solid rgba(255, 77, 0, 0.12)",
                  }}
                >
                  <MessageSquare size={24} strokeWidth={1.4} style={{ color: "#ff4d00" }} />
                </div>
                <div className="text-center">
                  <p className="text-[15px] font-semibold text-text-primary mb-1">Start a conversation</p>
                  <p className="text-[12px] text-text-tertiary">
                    Select a model and type a message below
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}

            {/* Streaming response */}
            {streamedText && (
              <div className="mb-4 animate-fade-in">
                <div
                  className="rounded-2xl rounded-bl-md px-4 py-3"
                  style={{
                    background: "var(--color-bg-card)",
                    border: "1px solid var(--color-border-light)",
                    maxWidth: "85%",
                    boxShadow: "var(--shadow-card)",
                  }}
                >
                  <MarkdownRenderer content={streamedText} />
                  {streaming && (
                    <span className="inline-block w-0.5 h-4 ml-0.5 rounded-full pulse" style={{ background: "#ff4d00" }} />
                  )}
                </div>
              </div>
            )}

            {/* Streaming meta */}
            {!streaming && meta && streamedText && (
              <div className="mb-4" style={{ maxWidth: "85%" }}>
                <CostBar meta={meta} />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Scroll to bottom */}
          {showScrollBtn && (
            <button
              onClick={scrollToBottom}
              className="fixed bottom-24 right-6 w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-105"
              style={{
                background: "var(--color-bg-elevated)",
                border: "1px solid var(--color-border)",
                boxShadow: "var(--shadow-elevated)",
              }}
            >
              <ArrowDown size={14} strokeWidth={2} className="text-text-secondary" />
            </button>
          )}
        </div>

        {/* Input area */}
        <div
          className="px-4 pb-4 pt-2 shrink-0"
          style={{ background: "var(--color-bg-panel)" }}
        >
          <div className="max-w-[720px] mx-auto">
            <div
              className="flex items-end gap-2 rounded-2xl px-3 py-1.5 transition-all"
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              {/* Search toggle */}
              {searchEnabled && (
                <button
                  onClick={() => setSearchOn(!searchOn)}
                  title={searchOn ? "Web search ON" : "Web search OFF"}
                  className={clsx(
                    "flex items-center justify-center w-8 h-8 rounded-lg shrink-0 mb-0.5 transition-colors",
                    searchOn
                      ? "bg-accent-green/12 text-accent-green"
                      : "text-text-tertiary hover:text-text-secondary hover:bg-hover-overlay",
                  )}
                >
                  <Globe size={15} strokeWidth={1.75} />
                </button>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Send a message..."
                rows={1}
                className="flex-1 bg-transparent py-2 text-[13px] leading-relaxed text-text-primary placeholder:text-text-tertiary outline-none resize-none"
                style={{
                  fontFamily: "var(--font-sans)",
                  maxHeight: 140,
                  caretColor: "#ff4d00",
                }}
              />
              <button
                onClick={() => streaming ? abort() : handleSend()}
                disabled={!streaming && !input.trim()}
                className={clsx(
                  "flex items-center justify-center w-8 h-8 rounded-xl shrink-0 mb-0.5 transition-all",
                  streaming
                    ? "bg-accent-red/12 text-accent-red hover:bg-accent-red/20"
                    : input.trim()
                      ? "text-white hover:scale-105"
                      : "bg-hover-overlay text-text-tertiary cursor-default",
                )}
                style={!streaming && input.trim() ? {
                  background: "#ff4d00",
                  boxShadow: "0 0 12px rgba(255, 77, 0, 0.3)",
                } : undefined}
              >
                {streaming ? <Square size={13} fill="currentColor" /> : <Send size={13} />}
              </button>
            </div>
            <p className="text-[10px] text-text-tertiary text-center mt-2 opacity-60">
              Routed via RouteBox · {model}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Message Bubble ────────────────────────────────────────────────────────────

const MessageBubble: React.FC<{ message: DisplayMessage }> = ({ message }) => {
  const isUser = message.role === "user";
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
      className={clsx("flex mb-4", isUser ? "justify-end" : "justify-start")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex flex-col gap-1" style={{ maxWidth: "85%" }}>
        <div
          className={clsx(
            "px-4 py-3 transition-shadow",
            isUser
              ? "rounded-2xl rounded-br-md"
              : "rounded-2xl rounded-bl-md",
          )}
          style={{
            background: isUser
              ? "rgba(255, 77, 0, 0.08)"
              : "var(--color-bg-card)",
            border: isUser
              ? "1px solid rgba(255, 77, 0, 0.12)"
              : "1px solid var(--color-border-light)",
            boxShadow: isUser ? "none" : "var(--shadow-card)",
          }}
        >
          {isUser ? (
            <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-text-primary">
              {message.content}
            </div>
          ) : (
            <MarkdownRenderer content={message.content} />
          )}
        </div>

        {/* Meta bar + Copy */}
        <div className="flex items-center gap-1 px-1">
          {metaObj && metaObj.cost > 0 && (
            <CostBar meta={metaObj} compact />
          )}
          {!isUser && (
            <button
              onClick={handleCopy}
              className={clsx(
                "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] transition-all",
                copied
                  ? "text-accent-green"
                  : "text-text-tertiary hover:text-text-secondary hover:bg-hover-overlay",
              )}
              style={{ opacity: hovered || copied ? 1 : 0 }}
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
