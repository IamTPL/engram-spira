import pino from 'pino';
import { ENV } from '../config/env';

const isDev = ENV.NODE_ENV !== 'production';

/**
 * Centralized Pino logger — single instance shared across the entire API.
 *
 * Dev  → pino-pretty (colorized, human-readable) via worker transport.
 * Prod → raw NDJSON to stdout; pipe through `pino-pretty` CLI if needed.
 *
 * Performance notes:
 *  - Pino serialises asynchronously via a dedicated worker thread in dev.
 *  - In production no extra process is spawned; output is raw JSON.
 *  - Use child loggers (`logger.child({ module: 'auth' })`) to add context
 *    without recreating the root logger.
 */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
    // Redact sensitive fields from ALL log lines
    redact: {
      paths: [
        'password',
        'passwordHash',
        'token',
        'resetToken',
        '*.password',
        '*.passwordHash',
        '*.token',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: '[REDACTED]',
    },
    // Standardise timestamp key to match common log aggregators
    timestamp: pino.stdTimeFunctions.isoTime,
    // Minimal base fields — avoids noise in high-frequency log lines
    base: { pid: process.pid },
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid',
          messageFormat: '{msg}',
        },
      })
    : undefined,
);
