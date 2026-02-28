# Changelog

## 1.0.0 (2026-02-28)

### Features
- OpenAI-compatible LLM proxy with multi-provider routing
- Smart Auto, Cost First, Speed First, Quality First routing strategies
- Model preferences: pin models to providers or exclude providers
- Real-time dashboard with traffic sparkline, cost tracking, savings
- Provider key management with validation (OpenAI, Anthropic, Google, DeepSeek, Mistral, Flock)
- Request log with detail view
- Analytics with time series, provider breakdown, top models
- Monthly budget alerts (80% and 100% thresholds)
- macOS menu bar app with system tray
- Gateway auto-start from desktop app
- Keychain-based auth token storage

### Security
- Auto-generated gateway auth tokens (persisted to DB)
- Rate limiting: 60 req/min per token
- CORS restricted to Tauri and localhost origins
- 30s timeout on upstream provider requests
- Request body validation and size limits
