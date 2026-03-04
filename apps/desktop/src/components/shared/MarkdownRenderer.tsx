import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  return (
    <div className={`markdown-body ${className ?? ""}`}>
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
                    background: "rgba(245, 245, 247, 0.12)",
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
                  background: "#1D1D1F",
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
        {content}
      </ReactMarkdown>
    </div>
  );
};
