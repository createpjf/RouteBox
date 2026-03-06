# Changelog

## 3.0.0 (2026-03-06)

### Cloud Gateway
- **Model Registry**: Dynamic model CRUD with DB-backed registry, admin API + UI
- **Scoring Engine**: Intelligent model routing with quality/speed/cost/code scoring, request context analysis (code detection, CJK support), configurable weights per strategy
- **Provider Access Control**: Per-provider enable/disable with plan-based gating (free/pro)
- **Admin Dashboard Enhancements**:
  - User management: edit plan (free/pro), adjust balance with audit trail
  - Pagination for users and transactions tables
  - Email search for user lookup
  - Loading states and error recovery
  - Client-side form validation for model registry
  - XSS fix in registry edit (ID-based lookup replaces inline JSON)
- **Bug Fixes**:
  - Fixed stateful regex causing inconsistent code block detection across requests
  - Fixed prefix-match models incorrectly flagged as fallback in scoring engine
  - Fixed score clamping causing unstable sort order among top models
  - Atomic updateModel — single SQL UPDATE instead of N separate queries
  - Improved CJK detection and weighted token estimation

### Desktop App
- Brave Search integration
- Dedicated Chat window with full conversation support
- Thinking model support (extended thinking / reasoning)
- Spotlight V2 with streaming chat
- Local model support (Ollama + LM Studio)
- Global keyboard shortcuts for Spotlight and Chat
- Usage tracking and analytics pages

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
