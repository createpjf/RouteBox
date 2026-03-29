import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { API_BASE_URL } from "@/lib/constants";

const TOOLS = ["Claude Code", "Codex CLI", "OpenAI API", "Python SDK", "cURL"] as const;
type Tool = (typeof TOOLS)[number];

const TOOL_CONTENT: Record<Tool, { description: string; code: string }> = {
  "Claude Code": {
    description: "Set two environment variables to run Claude Code. All requests will automatically use your API key.",
    code: `ANTHROPIC_AUTH_TOKEN="your-api-key" \\
ANTHROPIC_BASE_URL="${API_BASE_URL}/v1" \\
claude`,
  },
  "Codex CLI": {
    description: "Configure Codex CLI to use RouteBox as the provider.",
    code: `# Set environment variables
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="${API_BASE_URL}/v1"

# Run Codex CLI
codex`,
  },
  "OpenAI API": {
    description: "Use RouteBox as a drop-in replacement for the OpenAI API. Works with any OpenAI-compatible client.",
    code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${API_BASE_URL}/v1",
  apiKey: "your-api-key",
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);`,
  },
  "Python SDK": {
    description: "Use the OpenAI Python SDK with RouteBox. Supports all models across providers.",
    code: `from openai import OpenAI

client = OpenAI(
    base_url="${API_BASE_URL}/v1",
    api_key="your-api-key"
)

# Use any model — RouteBox routes automatically
response = client.chat.completions.create(
    model="claude-sonnet-4-6",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)`,
  },
  "cURL": {
    description: "Make direct HTTP requests to the RouteBox API.",
    code: `curl ${API_BASE_URL}/v1/chat/completions \\
  -H "Authorization: Bearer your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'`,
  },
};

export function ApiDocs() {
  const [selectedTool, setSelectedTool] = useState<Tool>("Claude Code");
  const [copied, setCopied] = useState(false);

  function copyCode() {
    navigator.clipboard.writeText(TOOL_CONTENT[selectedTool].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const content = TOOL_CONTENT[selectedTool];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* How to Use */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-text-primary mb-4">How to Use</h2>

        {/* Tool Tabs */}
        <div className="flex flex-wrap gap-0 border border-border rounded-xl overflow-hidden mb-6">
          {TOOLS.map((tool) => (
            <button
              key={tool}
              onClick={() => setSelectedTool(tool)}
              className={`flex-1 min-w-[120px] px-4 py-3 text-sm font-medium transition-colors border-r border-border last:border-r-0 ${
                selectedTool === tool
                  ? "bg-bg-card text-text-primary"
                  : "bg-bg-elevated/50 text-text-secondary hover:text-text-primary hover:bg-bg-elevated"
              }`}
            >
              {tool}
            </button>
          ))}
        </div>

        {/* Description */}
        <p className="text-sm text-text-secondary mb-4">{content.description}</p>

        {/* Code Block */}
        <div className="relative">
          <pre className="bg-bg-elevated rounded-xl p-5 overflow-x-auto text-sm font-mono text-text-primary leading-relaxed whitespace-pre-wrap">
            {content.code}
          </pre>
          <button
            onClick={copyCode}
            className="absolute top-3 right-3 btn-ghost h-8 px-3 bg-bg-card/80 backdrop-blur border border-border text-xs"
          >
            {copied ? (
              <>
                <Check size={12} className="text-accent-green" /> Copied
              </>
            ) : (
              <>
                <Copy size={12} /> Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Supported Models */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-text-primary mb-4">Supported Models</h2>
        <p className="text-sm text-text-secondary mb-4">
          RouteBox automatically routes to the best provider. Use any model name — we handle the rest.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { provider: "Anthropic", models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"], color: "var(--color-provider-anthropic)" },
            { provider: "OpenAI", models: ["gpt-5.4", "gpt-4o", "gpt-4o-mini", "o3", "o4-mini"], color: "var(--color-provider-openai)" },
            { provider: "Google", models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"], color: "var(--color-provider-google)" },
            { provider: "DeepSeek", models: ["deepseek-chat", "deepseek-reasoner"], color: "var(--color-provider-deepseek)" },
            { provider: "MiniMax", models: ["MiniMax-M2.5", "MiniMax-M2.1"], color: "#FF6B35" },
            { provider: "Kimi", models: ["kimi-k2.5", "kimi-k2", "moonshot-v1-128k"], color: "#6366F1" },
          ].map((group) => (
            <div key={group.provider} className="bg-bg-elevated/50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full" style={{ background: group.color }} />
                <span className="text-sm font-semibold text-text-primary">{group.provider}</span>
              </div>
              <div className="space-y-1">
                {group.models.map((m) => (
                  <div key={m} className="text-xs font-mono text-text-secondary">{m}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API Reference */}
      <div className="card p-6">
        <h2 className="text-base font-semibold text-text-primary mb-4">API Reference</h2>
        <div className="space-y-4">
          <div className="bg-bg-elevated/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="badge bg-accent-green/15 text-accent-green">GET</span>
              <code className="font-mono text-sm text-text-primary">/v1/models</code>
            </div>
            <p className="text-xs text-text-secondary mt-1">List all available models</p>
          </div>
          <div className="bg-bg-elevated/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="badge bg-accent-blue/15 text-accent-blue">POST</span>
              <code className="font-mono text-sm text-text-primary">/v1/chat/completions</code>
            </div>
            <p className="text-xs text-text-secondary mt-1">Create a chat completion (streaming & non-streaming)</p>
          </div>
          <div className="bg-bg-elevated/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="badge bg-accent-blue/15 text-accent-blue">POST</span>
              <code className="font-mono text-sm text-text-primary">/v1/embeddings</code>
            </div>
            <p className="text-xs text-text-secondary mt-1">Create text embeddings</p>
          </div>
        </div>
      </div>
    </div>
  );
}
