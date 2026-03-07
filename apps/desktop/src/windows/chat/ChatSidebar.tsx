import React, { useState } from "react";
import { Plus, Search, Trash2, Pin, XCircle } from "lucide-react";
import clsx from "clsx";
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
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const groups: { label: string; items: ConversationSummary[] }[] = [];
  const todayItems = filtered.filter((c) => c.updated_at >= today.getTime());
  const yesterdayItems = filtered.filter(
    (c) => c.updated_at >= yesterday.getTime() && c.updated_at < today.getTime(),
  );
  const weekItems = filtered.filter(
    (c) => c.updated_at >= weekAgo.getTime() && c.updated_at < yesterday.getTime(),
  );
  const olderItems = filtered.filter((c) => c.updated_at < weekAgo.getTime());

  if (todayItems.length) groups.push({ label: "Today", items: todayItems });
  if (yesterdayItems.length) groups.push({ label: "Yesterday", items: yesterdayItems });
  if (weekItems.length) groups.push({ label: "This Week", items: weekItems });
  if (olderItems.length) groups.push({ label: "Earlier", items: olderItems });

  return (
    <div
      className="flex flex-col w-[220px] shrink-0 border-r border-border"
      style={{ background: "var(--color-bg-panel)" }}
    >
      {/* Drag region + New Chat button */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1" data-tauri-drag-region>
        <div className="flex-1" data-tauri-drag-region />
        <button
          onClick={onNew}
          className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-hover-overlay transition-colors"
          title="New Chat"
        >
          <Plus size={16} strokeWidth={1.75} className="text-text-secondary" />
        </button>
      </div>

      {/* Search */}
      <div className="px-2.5 pb-2">
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
          style={{ background: "var(--color-bg-input)", border: "1px solid var(--color-border)" }}
        >
          <Search size={12} strokeWidth={1.75} className="text-text-tertiary shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats..."
            className="flex-1 bg-transparent outline-none text-[11px] text-text-primary placeholder:text-text-tertiary"
            style={{ fontFamily: "var(--font-sans)" }}
          />
          {search && (
            <button onClick={() => setSearch("")} className="shrink-0">
              <XCircle size={11} strokeWidth={1.75} className="text-text-tertiary" />
            </button>
          )}
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2" style={{ scrollbarWidth: "thin" }}>
        {groups.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full opacity-40 px-4">
            <p className="text-[11px] text-text-tertiary text-center">
              {search ? "No matching chats" : "No conversations yet"}
            </p>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.label} className="mb-1">
            <div className="section-header px-2 pt-2.5 pb-1 text-[9px]">
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
                  className={clsx(
                    "flex items-center gap-1.5 w-full px-2.5 py-[7px] rounded-lg text-left transition-colors mb-0.5",
                    isActive
                      ? "bg-hover-overlay text-text-primary"
                      : "text-text-secondary hover:bg-bg-row-hover hover:text-text-primary",
                  )}
                >
                  {conv.pinned === 1 && (
                    <Pin size={9} strokeWidth={2} className="text-accent-amber shrink-0" />
                  )}
                  <span className="flex-1 text-[12px] truncate">
                    {conv.title}
                  </span>
                  {(isHovered || isActive) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(conv.id);
                      }}
                      className="flex items-center justify-center w-5 h-5 rounded-md hover:bg-accent-red/10 transition-colors shrink-0"
                    >
                      <Trash2 size={10} strokeWidth={1.75} className="text-text-tertiary hover:text-accent-red" />
                    </button>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom: New Chat */}
      <div className="p-2.5 border-t border-border">
        <button
          onClick={onNew}
          className="flex items-center justify-center gap-1.5 w-full h-8 rounded-lg text-[12px] font-medium transition-colors"
          style={{
            background: "rgba(255, 77, 0, 0.08)",
            border: "1px solid rgba(255, 77, 0, 0.15)",
            color: "#ff4d00",
          }}
        >
          <Plus size={14} strokeWidth={1.75} />
          New Chat
        </button>
      </div>
    </div>
  );
};
