# RouteBox

macOS menu bar app — LLM API proxy with intelligent routing, real-time monitoring, and cost tracking.

## What it does

RouteBox runs a local OpenAI-compatible proxy (`http://localhost:3001/v1`). You point your apps at it instead of directly at OpenAI/Anthropic/etc. RouteBox then:

1. **Routes** requests to the best provider based on your rules (cheapest, fastest, or smartest)
2. **Tracks** tokens, cost, latency, and savings in real-time
3. **Manages** multiple provider API keys securely in macOS Keychain

```
Your App  →  RouteBox (localhost:3001)  →  OpenAI / Anthropic / Google / DeepSeek / MiniMax / Kimi / FLock.io
```

## Supported Providers

| Provider | Models | Get API Key |
|----------|--------|-------------|
| [OpenAI](https://openai.com) | GPT-5.2, GPT-5 | [platform.openai.com](https://platform.openai.com/api-keys) |
| [Anthropic](https://anthropic.com) | Claude Sonnet 4.6, Claude Haiku 4.5, Claude Opus 4.6 | [console.anthropic.com](https://console.anthropic.com/) |
| [Google](https://ai.google.dev) | Gemini 3.1 Pro, Gemini 3.1 Flash | [aistudio.google.com](https://aistudio.google.com/apikey) |
| [DeepSeek](https://deepseek.com) | DeepSeek-V3.2, DeepSeek-R1 | [platform.deepseek.com](https://platform.deepseek.com/) |
| [MiniMax](https://minimax.io) | MiniMax-M2.5, MiniMax-M2.1 | [platform.minimaxi.com](https://platform.minimaxi.com/) |
| [Kimi](https://kimi.ai) | Kimi K2.5, Kimi K2, Moonshot | [platform.moonshot.ai](https://platform.moonshot.ai/) |
| [FLock.io](https://flock.io) | Qwen3-235B, Qwen3-30B, DeepSeek-V3.2, Kimi K2.5 | [platform.flock.io](https://platform.flock.io) |

> **Tip:** [FLock API Platform](https://platform.flock.io) provides access to open-source models (Qwen3, DeepSeek, Kimi) 嗎，— a good option for cost-effective routing.

## Setup

### Prerequisites

- macOS 12+
- [Node.js](https://nodejs.org) 20+, [pnpm](https://pnpm.io) 10+
- [Bun](https://bun.sh) 1.x
- [Rust](https://rustup.rs) (stable)
- Xcode CLT (`xcode-select --install`)

### 1. Install & Run

```bash
git clone https://github.com/createpjf/RouteBox.git
cd RouteBox
pnpm install
cd apps/desktop
pnpm tauri dev
```

App appears in menu bar. Press `⌘⇧R` to toggle the panel.

### 2. Add Provider Keys

Open RouteBox → **Settings → Providers** → Add your API keys for any [supported provider](#supported-providers).

Keys are stored in macOS Keychain, never leave your machine.

### 3. Use the Proxy

Point any OpenAI-compatible client to RouteBox:

```bash
# The auth token is shown in Settings → Authentication
curl http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer YOUR_ROUTEBOX_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'
```

Or in Python:
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3001/v1",
    api_key="YOUR_ROUTEBOX_TOKEN"
)
```

## App Tabs

| Tab | What it shows |
|-----|---------------|
| **Dashboard** | Requests, tokens, cost, savings, traffic sparkline, provider status |
| **Routing** | Strategy selector, model preferences (pin/exclude), content-aware rules |
| **Logs** | Full request history with model, provider, latency, cost per request |
| **Analytics** | Charts for cost trends, provider latency, model usage breakdown |

## Routing

### Strategy

Pick one in the Routing tab:

| Strategy | Behavior |
|----------|----------|
| Smart Auto | AI picks the best route per request |
| Cost First | Always pick the cheapest provider |
| Speed First | Always pick the lowest latency provider |
| Quality First | Always pick the best available model |

### Rules

Create rules to route specific request types:

| Rule Type | Triggers when... | Example use |
|-----------|-------------------|-------------|
| **Alias** | Model name matches your virtual name | `route-code` → `deepseek-coder` |
| **Code** | Request contains ≥3 code markers | Auto-route code tasks to DeepSeek |
| **Long** | Message ≥8,000 characters | Auto-route long context to Gemini |
| **General** | Catch-all fallback | Default model for everything else |

### Model Preferences

Pin a model to a specific provider, or exclude a provider for a model:

- **Pin**: `gpt-4o` → always use OpenAI (never fall back)
- **Exclude**: `gpt-4o` → never use provider X

## Build DMG

```bash
cd apps/desktop

# Basic build
pnpm tauri build

# With updater signing
TAURI_SIGNING_PRIVATE_KEY="$(cat src-tauri/routebox-signer.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="routebox" \
pnpm tauri build
```

> **External drive?** Add `CARGO_TARGET_DIR=/tmp/routebox-target` to avoid `._*` file issues.

Output: `RouteBox.app`, `.dmg`, `.app.tar.gz` (updater), `.sig` (signature)

## Docker (Gateway Only)

Run just the gateway as a standalone proxy (no macOS desktop UI):

```bash
cd apps/gateway
docker build -t routebox-gateway .
docker run -p 3001:3001 \
  -e OPENAI_API_KEY=sk-... \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v routebox-data:/data \
  routebox-gateway
```

See [`apps/gateway/.env.example`](apps/gateway/.env.example) for all environment variables.

## Settings

| Setting | Location | Notes |
|---------|----------|-------|
| Provider API Keys | Settings → Providers | Stored in macOS Keychain |
| Monthly Budget | Settings → Budget | Alerts at 80% and 100% |
| Gateway URL | Settings → Connection | Default `http://localhost:3001`, customizable |
| Auth Token | Settings → Authentication | Auto-generated, stored in Keychain |
| Auto-start Gateway | Settings → Gateway | On/off toggle |
| Check for Updates | Settings → About | Downloads and installs automatically |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘⇧R` | Toggle panel (global) |
| `⌘C` | Copy API key |
| `⌘P` | Pause/resume traffic |

## Tech Stack

- **Desktop**: Tauri v2 (Rust) + React 19 + TypeScript + Tailwind CSS v4
- **Gateway**: Bun + Hono + bun:sqlite
- **Design**: SF Pro, frosted glass (macOS native)

## License

[MIT](LICENSE)
