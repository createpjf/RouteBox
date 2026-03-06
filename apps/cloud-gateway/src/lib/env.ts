// ---------------------------------------------------------------------------
// Environment variable validation — fail-fast on startup
// ---------------------------------------------------------------------------

import { log } from "./logger";

export function validateEnv(): void {
  const required = [
    "DATABASE_URL",
    "JWT_SECRET",
    "POLAR_ACCESS_TOKEN",
    "POLAR_WEBHOOK_SECRET",
  ];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    log.fatal("missing_env_vars", { missing });
    process.exit(1);
  }

  // Reject the default dev secret in production
  if (process.env.JWT_SECRET === "routebox-dev-secret-change-me") {
    log.fatal("insecure_jwt_secret", { reason: "default value" });
    process.exit(1);
  }

  // Enforce minimum secret length
  if ((process.env.JWT_SECRET?.length ?? 0) < 32) {
    log.fatal("insecure_jwt_secret", { reason: "too short (min 32 chars)" });
    process.exit(1);
  }

  // Warn if no LLM provider API keys are configured
  const providerKeys = [
    "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
    "DEEPSEEK_API_KEY", "MINIMAX_API_KEY", "KIMI_API_KEY",
    "OPENROUTER_API_KEY",
  ];
  const hasProvider = providerKeys.some((k) => !!process.env[k]);
  if (!hasProvider) {
    log.warn("no_provider_keys", {
      message: "No LLM provider API keys configured. API proxy will be non-functional.",
    });
  }

  if (!process.env.SENTRY_DSN) {
    log.info("sentry_disabled", { message: "SENTRY_DSN not set, error tracking disabled" });
  }
}
