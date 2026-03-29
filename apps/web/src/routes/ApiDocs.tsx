import { useState, useEffect } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import * as api from "@/lib/api";
import { API_BASE_URL } from "@/lib/constants";

const CODE_EXAMPLES = {
  python: `from openai import OpenAI

client = OpenAI(
    base_url="${API_BASE_URL}/v1",
    api_key="YOUR_API_KEY"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)`,

  javascript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${API_BASE_URL}/v1",
  apiKey: "YOUR_API_KEY",
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);`,

  curl: `curl ${API_BASE_URL}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
};

type Lang = keyof typeof CODE_EXAMPLES;

export function ApiDocs() {
  const [models, setModels] = useState<{ id: string; owned_by: string }[]>([]);
  const [selectedLang, setSelectedLang] = useState<Lang>("python");
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getModels()
      .then((res) => setModels(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function copyText(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">API Documentation</h1>
        <p className="text-text-secondary mt-1">Get started with the RouteBox Cloud API</p>
      </div>

      {/* Endpoint */}
      <div className="glass-card-static p-6">
        <h2 className="section-header">API Endpoint</h2>
        <div className="flex items-center gap-3 bg-bg-elevated rounded-lg px-4 py-3">
          <code className="flex-1 font-mono text-sm text-accent-ember">{API_BASE_URL}/v1</code>
          <button onClick={() => copyText("endpoint", `${API_BASE_URL}/v1`)} className="btn-ghost h-8 px-2">
            {copied === "endpoint" ? <Check size={14} className="text-accent-green" /> : <Copy size={14} />}
          </button>
        </div>
        <p className="text-sm text-text-secondary mt-3">
          RouteBox Cloud is fully OpenAI-compatible. Use it as a drop-in replacement for any OpenAI SDK.
          Your requests are automatically routed to the best provider based on model, cost, and performance.
        </p>
      </div>

      {/* Quick Start */}
      <div className="glass-card-static p-6">
        <h2 className="section-header">Quick Start</h2>

        {/* Language tabs */}
        <div className="flex gap-1 mb-4 bg-bg-elevated rounded-lg p-1 w-fit">
          {(["python", "javascript", "curl"] as Lang[]).map((lang) => (
            <button
              key={lang}
              onClick={() => setSelectedLang(lang)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                selectedLang === lang
                  ? "bg-accent-ember text-white"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {lang}
            </button>
          ))}
        </div>

        <div className="relative">
          <pre className="bg-bg-elevated rounded-xl p-4 overflow-x-auto text-sm font-mono text-text-primary leading-relaxed">
            {CODE_EXAMPLES[selectedLang]}
          </pre>
          <button
            onClick={() => copyText("code", CODE_EXAMPLES[selectedLang])}
            className="absolute top-3 right-3 btn-ghost h-7 px-2 bg-bg-card/80 backdrop-blur"
          >
            {copied === "code" ? <Check size={13} className="text-accent-green" /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      {/* Features */}
      <div className="glass-card-static p-6">
        <h2 className="section-header">Key Features</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { title: "Multi-Provider Routing", desc: "Requests automatically route to OpenAI, Anthropic, Google, DeepSeek, and more" },
            { title: "OpenAI Compatible", desc: "Drop-in replacement for the OpenAI API — works with any OpenAI SDK" },
            { title: "Smart Fallback", desc: "Automatic retry and fallback to alternative providers on errors" },
            { title: "Usage Tracking", desc: "Real-time cost tracking, token usage, and latency monitoring" },
          ].map((f) => (
            <div key={f.title} className="p-4 rounded-xl bg-bg-elevated/50">
              <div className="text-sm font-semibold text-text-primary mb-1">{f.title}</div>
              <div className="text-xs text-text-secondary">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Available Models */}
      <div className="glass-card-static p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-header mb-0">Available Models</h2>
          {loading && <div className="h-4 w-20 skeleton" />}
        </div>

        {models.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {models.map((m) => (
              <div key={m.id} className="flex items-center gap-2 py-2 px-3 rounded-lg bg-bg-elevated/50">
                <code className="flex-1 font-mono text-xs text-text-primary truncate">{m.id}</code>
                <span className="text-xs text-text-tertiary shrink-0">{m.owned_by}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-text-secondary text-center py-4">
            {loading ? "Loading models..." : "No models available"}
          </div>
        )}
      </div>

      {/* Links */}
      <div className="flex gap-4">
        <a href="https://github.com/createpjf/RouteBox" target="_blank" rel="noopener noreferrer"
          className="btn-secondary text-sm">
          <ExternalLink size={14} /> GitHub Repository
        </a>
      </div>
    </div>
  );
}
