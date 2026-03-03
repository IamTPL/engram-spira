const ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  PORT: Number(process.env.PORT) || 3001,
  NODE_ENV:
    (process.env.NODE_ENV as 'development' | 'production') || 'development',
  SESSION_COOKIE_NAME: 'engram_session',
  SESSION_MAX_AGE_DAYS: 30,
  SESSION_REFRESH_THRESHOLD_DAYS: 15,
  // ── Email (Gmail SMTP) ────────────────────────────────────
  GMAIL_USER: process.env.GMAIL_USER || '',
  GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD || '',
  FEEDBACK_RECIPIENT:
    process.env.FEEDBACK_RECIPIENT || 'tranphilong030201@gmail.com',
} as const;

// Validate required env vars at startup
const REQUIRED_VARS = ['DATABASE_URL'] as const;

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export { ENV };
