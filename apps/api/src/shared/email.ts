import nodemailer from 'nodemailer';
import { ENV } from '../config/env';

/* ══════════════════════════════════════════════════════════════
   EMAIL UTILITY — Gmail SMTP via Nodemailer
   ══════════════════════════════════════════════════════════════
   Setup:
   1. Enable 2FA on the Gmail account you want to use for sending
   2. Go to https://myaccount.google.com/apppasswords
   3. Create an App Password → select "Mail" + "Other (Custom name)"
   4. Copy the 16-char password → set GMAIL_APP_PASSWORD in .env
   ══════════════════════════════════════════════════════════════ */

/** Lazy-init transporter — only created when first email is sent */
let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!_transporter) {
    if (!ENV.GMAIL_USER || !ENV.GMAIL_APP_PASSWORD) {
      throw new Error(
        'Email not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in .env',
      );
    }
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: ENV.GMAIL_USER,
        // Google displays App Password with spaces for readability — strip them
        pass: ENV.GMAIL_APP_PASSWORD.replace(/\s/g, ''),
      },
    });
  }
  return _transporter;
}

/* ── Type labels ─────────────────────────────────────────────── */
const TYPE_LABELS: Record<string, string> = {
  bug: '🐛 Bug Report',
  feature: '💡 Feature Request',
  general: '💬 General Feedback',
};

/* ── Send feedback email ─────────────────────────────────────── */
export interface FeedbackEmailParams {
  fromEmail: string;
  /** User-provided contact email (optional) */
  contactEmail?: string;
  type: string;
  subject: string;
  message: string;
}

export async function sendFeedbackEmail(
  params: FeedbackEmailParams,
): Promise<void> {
  const { fromEmail, contactEmail, type, subject, message } = params;
  const typeLabel = TYPE_LABELS[type] ?? type;
  const replyTo = contactEmail?.trim() || fromEmail;
  const safeMessage = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');

  const contactRow = contactEmail?.trim()
    ? `<p class="meta">Reply to: <strong><a href="mailto:${contactEmail.trim()}" style="color:#2563eb;">${contactEmail.trim()}</a></strong></p>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; background: #f8fafc; margin: 0; padding: 24px; }
    .card { background: #ffffff; border-radius: 12px; padding: 28px 32px; max-width: 560px; margin: 0 auto; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .badge { display: inline-block; background: #eff6ff; color: #2563eb; border-radius: 6px; padding: 3px 10px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
    h2 { margin: 0 0 4px; font-size: 18px; }
    .meta { color: #64748b; font-size: 13px; margin-bottom: 8px; }
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 20px 0; }
    .message-body { background: #f8fafc; border-left: 3px solid #3b82f6; border-radius: 4px; padding: 14px 16px; font-size: 14px; line-height: 1.7; color: #334155; }
    .footer { color: #94a3b8; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${typeLabel}</div>
    <h2>${subject}</h2>
    <p class="meta">Account: <strong>${fromEmail}</strong></p>
    ${contactRow}
    <hr class="divider"/>
    <div class="message-body">${safeMessage}</div>
    <p class="footer">Sent via Engram Spira Feedback</p>
  </div>
</body>
</html>`;

  await getTransporter().sendMail({
    from: `"Engram Feedback" <${ENV.GMAIL_USER}>`,
    to: ENV.FEEDBACK_RECIPIENT,
    replyTo,
    subject: `[Engram] ${typeLabel}: ${subject}`,
    html,
  });

  console.log(
    `[email] Feedback sent from ${fromEmail} (${type}) → ${ENV.FEEDBACK_RECIPIENT}`,
  );
}

/* ── Send password reset email ───────────────────────────────── */
export async function sendPasswordResetEmail(
  toEmail: string,
  resetToken: string,
): Promise<void> {
  // In development, use localhost; in production, this should be the real frontend URL
  const baseUrl = ENV.FRONTEND_URL;
  const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; background: #f8fafc; margin: 0; padding: 24px; }
    .card { background: #ffffff; border-radius: 12px; padding: 28px 32px; max-width: 480px; margin: 0 auto; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    h2 { margin: 0 0 12px; font-size: 20px; }
    p { font-size: 14px; line-height: 1.6; color: #475569; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; margin: 16px 0; }
    .footer { color: #94a3b8; font-size: 12px; margin-top: 20px; }
    .code { background: #f1f5f9; padding: 8px 12px; border-radius: 6px; font-family: monospace; font-size: 13px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🔑 Password Reset</h2>
    <p>You requested a password reset for your Engram Spira account. Click the button below to set a new password:</p>
    <a href="${resetLink}" class="btn">Reset Password</a>
    <p>Or copy this link:</p>
    <div class="code">${resetLink}</div>
    <p>This link expires in <strong>1 hour</strong>. If you didn't request this, you can safely ignore this email.</p>
    <p class="footer">— Engram Spira</p>
  </div>
</body>
</html>`;

  await getTransporter().sendMail({
    from: `"Engram Spira" <${ENV.GMAIL_USER}>`,
    to: toEmail,
    subject: 'Engram Spira — Password Reset',
    html,
  });

  console.log(`[email] Password reset sent to ${toEmail}`);
}
