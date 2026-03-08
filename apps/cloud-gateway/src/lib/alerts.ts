// ---------------------------------------------------------------------------
// Admin Alerts — provider outage & error rate notifications via email
// ---------------------------------------------------------------------------

import { log } from "./logger";
import { setCircuitBreakerHook } from "./circuit-breaker";
import type { CircuitState } from "./circuit-breaker";

/** Debounce map: alert key → last alert timestamp */
const lastAlertAt = new Map<string, number>();
const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
const ERROR_RATE_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const ERROR_RATE_THRESHOLD = 0.3; // 30%

let errorRateTimer: ReturnType<typeof setInterval> | null = null;

function shouldAlert(key: string): boolean {
  const now = Date.now();
  const last = lastAlertAt.get(key) ?? 0;
  if (now - last < DEBOUNCE_MS) return false;
  lastAlertAt.set(key, now);
  return true;
}

/**
 * Initialize all admin alerts.
 * Call once at server startup.
 */
export function initAlerts(): void {
  // 1. Circuit breaker state change alerts
  setCircuitBreakerHook((id: string, from: CircuitState, to: CircuitState) => {
    if (to === "open" && shouldAlert(`cb:${id}`)) {
      sendProviderAlert(id, from).catch((err) => {
        log.warn("alert_send_failed", {
          provider: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  });

  // 2. Periodic error rate check (every 5 minutes)
  errorRateTimer = setInterval(() => {
    checkErrorRate().catch((err) => {
      log.warn("error_rate_check_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, ERROR_RATE_CHECK_INTERVAL);

  log.info("alerts_initialized");
}

/** Stop periodic checks (for graceful shutdown) */
export function stopAlerts(): void {
  if (errorRateTimer) {
    clearInterval(errorRateTimer);
    errorRateTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Circuit breaker alert
// ---------------------------------------------------------------------------

async function sendProviderAlert(providerId: string, fromState: string): Promise<void> {
  const { sendAdminAlert } = await import("./email");
  await sendAdminAlert(
    `Provider ${providerId} — Circuit Breaker OPEN`,
    `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="margin: 0 0 16px; color: #ef4444;">Provider Alert</h2>
        <p style="color: #555; line-height: 1.5;">
          The circuit breaker for <strong>${providerId}</strong> has transitioned from
          <code>${fromState}</code> to <strong style="color:#ef4444">OPEN</strong>.
        </p>
        <p style="color: #555; line-height: 1.5;">
          Requests to this provider are being blocked. The breaker will attempt recovery in 30 seconds.
        </p>
        <p style="color: #999; font-size: 13px; margin-top: 24px;">
          This alert is debounced — you will not receive another alert for this provider within 5 minutes.
        </p>
      </div>
    `,
  );
}

// ---------------------------------------------------------------------------
// Error rate monitoring — checks every 5 minutes
// ---------------------------------------------------------------------------

async function checkErrorRate(): Promise<void> {
  const { sql } = await import("./db-cloud");

  const rows = await sql`
    SELECT provider,
      COUNT(*)::int AS total,
      COUNT(CASE WHEN status != 'ok' THEN 1 END)::int AS errors
    FROM requests
    WHERE created_at > now() - interval '5 minutes'
    GROUP BY provider
    HAVING COUNT(*) >= 5
  `;

  for (const row of rows) {
    const errorRate = (row.errors as number) / (row.total as number);
    if (errorRate >= ERROR_RATE_THRESHOLD && shouldAlert(`errrate:${row.provider}`)) {
      const pct = (errorRate * 100).toFixed(1);
      log.warn("high_error_rate_detected", {
        provider: row.provider,
        errorRate: pct,
        total: row.total,
        errors: row.errors,
      });

      const { sendAdminAlert } = await import("./email");
      await sendAdminAlert(
        `High Error Rate — ${row.provider} (${pct}%)`,
        `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
            <h2 style="margin: 0 0 16px; color: #eab308;">Error Rate Alert</h2>
            <p style="color: #555; line-height: 1.5;">
              Provider <strong>${row.provider}</strong> has a <strong style="color:#ef4444">${pct}%</strong> error rate
              over the last 5 minutes (${row.errors}/${row.total} requests failed).
            </p>
            <p style="color: #999; font-size: 13px; margin-top: 24px;">
              Check the Provider Health dashboard for details.
            </p>
          </div>
        `,
      ).catch((err) => {
        log.warn("error_rate_alert_send_failed", {
          provider: row.provider,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }
}
