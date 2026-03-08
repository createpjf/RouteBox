// ---------------------------------------------------------------------------
// Email service — Resend
// ---------------------------------------------------------------------------

import { Resend } from "resend";
import { log } from "./logger";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
): Promise<void> {
  if (!resend) {
    log.warn("email_skip", { reason: "RESEND_API_KEY not configured", to });
    return;
  }

  const { error } = await resend.emails.send({
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

  if (error) {
    log.error("email_send_failed", { to, error: error.message });
    throw new Error(`Failed to send email: ${error.message}`);
  }

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
    const { error } = await resend.emails.send({
      from: "RouteBox Alerts <alerts@routebox.dev>",
      to,
      subject: `[RouteBox] ${subject}`,
      html,
    });

    if (error) {
      log.error("admin_alert_send_failed", { to, error: error.message });
    } else {
      log.info("admin_alert_sent", { to, subject });
    }
  }
}
