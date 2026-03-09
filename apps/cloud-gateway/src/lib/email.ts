// ---------------------------------------------------------------------------
// Email service — Resend
// ---------------------------------------------------------------------------

import { Resend } from "resend";
import { log } from "./logger";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const MAX_EMAIL_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/** Send email with retry (up to MAX_EMAIL_RETRIES attempts) */
async function sendWithRetry(
  params: Parameters<InstanceType<typeof Resend>["emails"]["send"]>[0],
): Promise<void> {
  if (!resend) return;

  for (let attempt = 0; attempt <= MAX_EMAIL_RETRIES; attempt++) {
    const { error } = await resend.emails.send(params);
    if (!error) return;

    if (attempt < MAX_EMAIL_RETRIES) {
      log.warn("email_send_retry", { to: params.to, attempt: attempt + 1, error: error.message });
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
    } else {
      log.error("email_send_failed", { to: params.to, error: error.message, attempts: attempt + 1 });
      throw new Error(`Failed to send email after ${attempt + 1} attempts: ${error.message}`);
    }
  }
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
): Promise<void> {
  if (!resend) {
    log.warn("email_skip", { reason: "RESEND_API_KEY not configured", to });
    return;
  }

  await sendWithRetry({
    from: "RouteBox <noreply@routebox.dev>",
    to,
    subject: "Reset your RouteBox password",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="margin: 0 0 16px;">Reset your password</h2>
        <p style="color: #555; line-height: 1.5;">
          Click the button below to reset your RouteBox password. This link expires in 1 hour.
        </p>
        <a href="${resetUrl}" style="display: inline-block; margin: 24px 0; padding: 12px 24px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500;">
          Reset Password
        </a>
        <p style="color: #999; font-size: 13px; line-height: 1.5;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });

  log.info("email_sent", { to, type: "password_reset" });
}

/**
 * Send an alert email to all admin emails (fire-and-forget).
 * Reads ADMIN_EMAILS env var (comma-separated).
 */
export async function sendAdminAlert(
  subject: string,
  html: string,
): Promise<void> {
  if (!resend) {
    log.warn("admin_alert_skip", { reason: "RESEND_API_KEY not configured" });
    return;
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (adminEmails.length === 0) {
    log.warn("admin_alert_skip", { reason: "ADMIN_EMAILS not configured" });
    return;
  }

  for (const to of adminEmails) {
    try {
      await sendWithRetry({
        from: "RouteBox Alerts <alerts@routebox.dev>",
        to,
        subject: `[RouteBox] ${subject}`,
        html,
      });
      log.info("admin_alert_sent", { to, subject });
    } catch (err) {
      log.error("admin_alert_send_failed", {
        to,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
