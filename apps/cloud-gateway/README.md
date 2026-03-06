# RouteBox Cloud Gateway

Multi-provider LLM routing gateway with an OpenAI-compatible API. Routes requests to OpenAI, Anthropic, Google, DeepSeek, MiniMax, and Kimi with automatic retry, fallback, and circuit breaker for high availability.

## Architecture

- **Runtime**: [Bun](https://bun.sh) + [Hono](https://hono.dev)
- **Database**: PostgreSQL (via `postgres` tagged template)
- **Payments**: Stripe (credit packages + subscriptions)
- **Auth**: JWT (jose library)
- **Monitoring**: Prometheus-compatible `/metrics` endpoint

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1+
- PostgreSQL 15+
- Stripe account (for billing features)

### Setup

```bash
# Install dependencies
cd apps/cloud-gateway
bun install

# Configure environment
cp .env.example .env
# Edit .env with your database URL, JWT secret, Stripe keys, and provider API keys

# Start development server
bun run dev
```

The server starts on port 3001 (configurable via `PORT` env var).

## API Endpoints

See [openapi.yaml](./openapi.yaml) for the complete API specification.

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/metrics` | Prometheus metrics |
| POST | `/auth/register` | User registration |
| POST | `/auth/login` | User login |
| GET | `/billing/packages` | Credit package list |
| GET | `/billing/plans` | Subscription plan list |
| POST | `/billing/webhook` | Stripe webhook handler |

### Authenticated (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/me` | Current user info |
| POST | `/billing/checkout` | Create credit checkout session |
| POST | `/billing/subscribe` | Create subscription checkout |
| POST | `/billing/cancel-subscription` | Cancel subscription |
| GET | `/account/me` | Full user profile |
| GET | `/account/balance` | Credit balance |
| GET | `/account/transactions` | Transaction history |
| GET | `/account/referral` | Referral code and stats |
| GET | `/account/analytics` | Usage analytics |
| GET | `/v1/models` | Available models |
| POST | `/v1/chat/completions` | Chat completion (streaming/non-streaming) |

## Multi-Provider Routing

The gateway pools API keys across multiple providers and routes requests based on model prefix matching.

### Supported Providers

| Provider | Models | Format |
|----------|--------|--------|
| OpenAI | gpt-4o, gpt-4.1, o3, o4-mini, ... | openai |
| Anthropic | claude-sonnet-4, claude-haiku-4, claude-opus-4, ... | anthropic |
| Google | gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash, ... | openai |
| DeepSeek | deepseek-chat, deepseek-reasoner | openai |
| MiniMax | MiniMax-M2.5, MiniMax-M2.1 | openai |
| Kimi | kimi-k2.5, kimi-k2, moonshot-v1-* | openai |

### Model Aliases

Convenience aliases resolve to specific model versions:

| Alias | Resolves To |
|-------|-------------|
| `claude-sonnet` | `claude-sonnet-4-20250514` |
| `claude-haiku` | `claude-haiku-4-20250514` |
| `claude-opus` | `claude-opus-4-20250514` |
| `gpt-4o-latest` | `gpt-4o` |
| `gemini-pro` | `gemini-2.5-pro` |
| `gemini-flash` | `gemini-2.0-flash` |

### Key Pooling

Each provider scans environment variables for multiple keys:

```
OPENAI_API_KEY=sk-...       # Key 1
OPENAI_API_KEY_2=sk-...     # Key 2
OPENAI_API_KEY_3=sk-...     # Key 3 (up to _10)
```

Requests are distributed across keys via round-robin with circuit breaker sorting (unhealthy keys are deprioritized).

## High Availability

- **Retry**: Up to 3 attempts per provider (configurable) with exponential backoff + jitter
- **Fallback**: If all retries on a provider fail, automatically tries the next provider in the chain
- **Circuit Breaker**: Per-provider-instance state machine (CLOSED → OPEN → HALF_OPEN) that prevents cascading failures

## Security

- **JWT Authentication**: All `/v1/*` and `/account/*` routes require a valid Bearer token
- **Rate Limiting**: Sliding window rate limits per IP (auth routes) and per user (API/account routes)
- **Credits Check**: Minimum balance of 50 cents required before API requests
- **CORS**: Configurable origin whitelist (defaults to Tauri desktop app origins)
- **Error Handling**: Stack traces stripped in production mode

## Monitoring

The `/metrics` endpoint exposes Prometheus-format metrics:

- `http_requests_total` — Total HTTP requests by method and status
- `http_request_duration_ms` — Request duration histogram
- `provider_requests_total` — Provider requests by provider, model, and status
- `provider_request_duration_ms` — Provider request duration histogram
- `provider_tokens_total` — Token usage by provider, model, and direction
- `errors_total` — Error count by type
- `active_requests` — Currently active request gauge
- `retry_attempts_total` — Retry attempts by model and final provider

## Docker

```bash
# Build
docker build -t routebox-cloud-gateway .

# Run
docker run -d -p 3001:3001 \
  -e DATABASE_URL=postgres://user:pass@host/db \
  -e JWT_SECRET=your-secret \
  -e STRIPE_SECRET_KEY=sk_... \
  -e STRIPE_WEBHOOK_SECRET=whsec_... \
  -e OPENAI_API_KEY=sk-... \
  routebox-cloud-gateway
```

The Docker image uses `oven/bun:1-alpine` with a non-root user (`routebox:1001`).

## Testing

```bash
# Run all tests
bun test

# Watch mode
bun test --watch

# With coverage
bun test --coverage
```

Tests use Bun's built-in test runner with a preload file (`test-setup.ts`) that provides unified mocks for database and Stripe modules.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT signing (min 256 bits) |
| `STRIPE_SECRET_KEY` | Yes | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret |
| `APP_URL` | No | App URL for Stripe redirects (default: `https://routebox.dev`) |
| `PORT` | No | Server port (default: `3001`) |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |
| `NODE_ENV` | No | Set to `production` to hide error details |
| `OPENAI_API_KEY` | No | OpenAI API key (supports `_2` through `_10` suffixes) |
| `ANTHROPIC_API_KEY` | No | Anthropic API key (supports `_2` through `_10` suffixes) |
| `GOOGLE_API_KEY` | No | Google AI API key (supports `_2` through `_10` suffixes) |
| `DEEPSEEK_API_KEY` | No | DeepSeek API key |
| `MINIMAX_API_KEY` | No | MiniMax API key |
| `KIMI_API_KEY` | No | Kimi/Moonshot API key |
