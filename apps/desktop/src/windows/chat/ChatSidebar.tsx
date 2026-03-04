import React, { useState } from "react";
import { Plus, Search, Trash2, Pin } from "lucide-react";
import type { ConversationSummary } from "../../lib/api";

interface ChatSidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
}) => {
  const [search, setSearch] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const filtered = conversations.filter(
    (c) => !search || c.title.toLowerCase().includes(search.toLowerCase()),
  );

  // Group by date
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups: { label: string; items: ConversationSummary[] }[] = [];
  const todayItems = filtered.filter((c) => c.updated_at >= today.getTime());
  const yesterdayItems = filtered.filter(
    (c) => c.updated_at >= yesterday.getTime() && c.updated_at < today.getTime(),
  );
  const olderItems = filtered.filter((c) => c.updated_at < yesterday.getTime());

  if (todayItems.length) groups.push({ label: "Today", items: todayItems });
  if (yesterdayItems.length) groups.push({ label: "Yesterday", items: yesterdayItems });
  if (olderItems.length) groups.push({ label: "Earlier", items: olderItems });

  return (
    <div
      style={{
        width: 230,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      {/* Header + search */}
      <div style={{ padding: "10px 10px 6px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 8px",
            background: "rgba(255,255,255,0.05)",
            borderRadius: 7,
          }}
        >
          <Search size={12} style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "rgba(255,255,255,0.8)",
              fontSize: 11,
              fontFamily: "inherit",
            }}
          />
        </div>
      </div>

      {/* Conversation list */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 6px" }}>
        {groups.length === 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 8,
              opacity: 0.3,
              padding: 16,
            }}
          >
            <span style={{ fontSize: 11, textAlign: "center" }}>No conversations yet</span>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.label}>
            <div
              style={{
                padding: "10px 6px 4px",
                fontSize: 10,
                fontWeight: 600,
                color: "rgba(255,255,255,0.25)",
                textTransform: "uppercase",
                letterSpacing: 0.6,
              }}
            >
              {group.label}
            </div>
            {group.items.map((conv) => {
              const isActive = conv.id === activeId;
              const isHovered = conv.id === hoveredId;

              return (
                <button
                  key={conv.id}
                  onClick={() => onSelect(conv.id)}
                  onMouseEnter={() => setHoveredId(conv.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    width: "100%",
                    padding: "7px 8px",
                    background: isActive
                      ? "rgba(255,255,255,0.07)"
                      : isHovered
                        ? "rgba(255,255,255,0.03)"
                        : "transparent",
                    border: "none",
                    borderRadius: 7,
                    color: isActive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.6)",
                    fontSize: 12,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.1s ease",
                  }}
                >
                  {conv.pinned === 1 && (
                    <Pin size={10} style={{ color: "#FFB340", flexShrink: 0 }} />
                  )}
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {conv.title}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 2,
                      cursor: "pointer",
                      color: "rgba(255,255,255,0.2)",
                      opacity: isHovered ? 0.7 : 0,
                      transition: "opacity 0.15s ease",
                      flexShrink: 0,
                    }}
                  >
                    <Trash2 size={10} />
                  </button>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* New chat button */}
      <div style={{ padding: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          onClick={onNew}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: "100%",
            padding: "8px 0",
            background: "rgba(88,166,255,0.08)",
            border: "1px solid rgba(88,166,255,0.12)",
            borderRadius: 8,
            color: "#58a6ff",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          <Plus size={14} /> New Chat
        </button>
      </div>
    </div>
  );
};
