const ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  PORT: Number(process.env.PORT) || 3001,
  NODE_ENV:
    (process.env.NODE_ENV as 'development' | 'production') || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3002',
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || 'http://localhost:3002')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
  SESSION_COOKIE_NAME: 'engram_session',
  SESSION_MAX_AGE_DAYS: 30,
  SESSION_REFRESH_THRESHOLD_DAYS: 15,
  // ── Email (Gmail SMTP) ────────────────────────────────────
  GMAIL_USER: process.env.GMAIL_USER || '',
  GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD || '',
  FEEDBACK_RECIPIENT:
    process.env.FEEDBACK_RECIPIENT || 'tranphilong030201@gmail.com',
  // ── Google Gemini AI ──────────────────────────────────────
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  // Model to use for card generation. Defaults to gemini-3-flash-preview.
  // Override via GEMINI_MODEL env var to switch models without code changes.
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
  GEMINI_EMBEDDING_MODEL:
    process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
} as const;

// Validate required env vars at startup
const REQUIRED_VARS = ['DATABASE_URL'] as const;

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export { ENV };
