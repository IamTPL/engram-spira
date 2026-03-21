/**
 * Preload script that mocks the DB module before any test imports.
 * 
 * This is loaded via bunfig.toml and runs before any test file,
 * ensuring the real Postgres connection is never established.
 */
import { mock } from 'bun:test';
import { resolve } from 'path';

// Absolute path to the DB module — resolved relative to this preload file
const DB_MODULE_PATH = resolve(import.meta.dir, '../src/db/index.ts');
const DB_SCHEMA_PATH = resolve(import.meta.dir, '../src/db/schema/index.ts');
const ENV_MODULE_PATH = resolve(import.meta.dir, '../src/config/env.ts');
const LOGGER_MODULE_PATH = resolve(import.meta.dir, '../src/shared/logger.ts');

// Mock ENV first to prevent .env file reading
mock.module(ENV_MODULE_PATH, () => ({
  ENV: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    PORT: 3001,
    NODE_ENV: 'test',
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
  },
}));

// Also mock with relative import specifiers used by source files
mock.module('../config/env', () => ({
  ENV: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    PORT: 3001,
    NODE_ENV: 'test',
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
  },
}));

// Mock logger to suppress output
const noopLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
};

mock.module(LOGGER_MODULE_PATH, () => ({ logger: noopLogger }));
mock.module('../shared/logger', () => ({ logger: noopLogger }));
mock.module('../../shared/logger', () => ({ logger: noopLogger }));
