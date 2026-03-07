import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ChevronRight } from "lucide-react";
import { stripThinkingTags } from "../../lib/thinking";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** If true, show thinking/reasoning blocks when present */
  showThinking?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className,
  showThinking = true,
}) => {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const { content: cleaned, thinking } = stripThinkingTags(content);

  return (
    <div className={`markdown-body ${className ?? ""}`}>
      {/* Thinking block — collapsible */}
      {showThinking && thinking && (
        <div
          style={{
            marginBottom: 8,
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            overflow: "hidden",
          }}
        >
          <button
            onClick={() => setThinkingOpen(!thinkingOpen)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              width: "100%",
              padding: "6px 10px",
              background: "var(--color-bg-row-hover)",
              border: "none",
              color: "var(--color-text-tertiary)",
              fontSize: 11,
              fontWeight: 500,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <ChevronRight
              size={12}
              style={{
                transform: thinkingOpen ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s ease",
                flexShrink: 0,
              }}
            />
            💭 Thinking{!thinkingOpen && "..."}
          </button>
          {thinkingOpen && (
            <div
              style={{
                padding: "8px 10px",
                fontSize: 11,
                lineHeight: 1.5,
                color: "var(--color-text-tertiary)",
                whiteSpace: "pre-wrap",
                maxHeight: 200,
                overflow: "auto",
                borderTop: "1px solid var(--color-border-light)",
              }}
            >
              {thinking}
            </div>
          )}
        </div>
      )}

      {/* Main content */}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className: codeClassName, children, ...props }) {
            const isInline = !codeClassName;
            if (isInline) {
              return (
                <code
                  style={{
                    background: "var(--color-md-inline-code-bg, rgba(245, 245, 247, 0.12))",
                    padding: "2px 6px",
                    borderRadius: 4,
                    fontSize: "0.875em",
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          },
          pre({ children, ...props }) {
            return (
              <pre
                style={{
                  background: "var(--color-md-code-bg, #0a0a0a)",
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 12,
                  fontFamily: "'SF Mono', 'Menlo', monospace",
                  overflow: "auto",
                  margin: "8px 0",
                }}
                {...props}
              >
                {children}
              </pre>
            );
          },
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
};
