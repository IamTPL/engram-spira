/**
 * Mocks for external dependencies: Gemini AI, nodemailer, argon2, email, logger
 */
import { mock } from 'bun:test';

// Mock argon2 (password hashing) — instant, no real crypto
export function mockArgon2() {
  mock.module('@node-rs/argon2', () => ({
    hash: mock(async (pw: string) => `$mock_hash$${pw}`),
    verify: mock(
      async (hash: string, pw: string) => hash === `$mock_hash$${pw}`,
    ),
  }));
}

// Mock nodemailer — no real SMTP
export function mockNodemailer() {
  const sendMail = mock(async () => ({ messageId: 'mock-msg-id' }));
  mock.module('nodemailer', () => ({
    createTransport: mock(() => ({ sendMail })),
  }));
  return { sendMail };
}

// Mock Google Generative AI — return canned responses
export function mockGeminiAI(responseText = '[]') {
  const generateContent = mock(async () => ({
    response: { text: () => responseText },
  }));
  const generateContentStream = mock(async () => ({
    stream: (async function* () {
      yield { text: () => responseText };
    })(),
  }));
  const getGenerativeModel = mock(() => ({
    generateContent,
    generateContentStream,
  }));
  const embedContent = mock(async () => ({
    embedding: { values: new Array(768).fill(0.1) },
  }));

  mock.module('@google/generative-ai', () => ({
    GoogleGenerativeAI: mock(function () {
      return {
        getGenerativeModel,
      };
    }),
  }));

  return {
    generateContent,
    generateContentStream,
    getGenerativeModel,
    embedContent,
  };
}

// Mock email shared module
export function mockEmailModule() {
  mock.module('../../shared/email', () => ({
    sendVerificationEmail: mock(async () => {}),
    sendPasswordResetEmail: mock(async () => {}),
  }));
}

// Mock logger (suppress output in tests)
export function mockLogger() {
  const noopLogger: any = {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
    child: mock(() => noopLogger),
  };
  mock.module('../../shared/logger', () => ({
    logger: noopLogger,
  }));
  return noopLogger;
}

// Mock ENV config
export function mockEnv(overrides: Record<string, any> = {}) {
  mock.module('../../config/env', () => ({
    ENV: {
      DATABASE_URL: 'postgresql://test',
      PORT: 3001,
      NODE_ENV: 'development',
      FRONTEND_URL: 'http://localhost:3002',
      ALLOWED_ORIGINS: ['http://localhost:3002'],
      SESSION_COOKIE_NAME: 'engram_session',
      SESSION_MAX_AGE_DAYS: 30,
      SESSION_REFRESH_THRESHOLD_DAYS: 15,
      GMAIL_USER: '',
      GMAIL_APP_PASSWORD: '',
      FEEDBACK_RECIPIENT: 'test@test.com',
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'gemini-3-flash-preview',
      GEMINI_EMBEDDING_MODEL: 'gemini-embedding-001',
      ...overrides,
    },
  }));
}
