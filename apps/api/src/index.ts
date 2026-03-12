import { Elysia } from 'elysia';
import { sql } from 'drizzle-orm';
import { cors } from '@elysiajs/cors';
import { ENV } from './config/env';
import { AppError } from './shared/errors';
import { db } from './db';
import { logger } from './shared/logger';
import { requestLoggerPlugin } from './plugins/logger.plugin';

// Import routes
import { authRoutes } from './modules/auth/auth.routes';
import { classesRoutes } from './modules/classes/classes.routes';
import { foldersRoutes } from './modules/folders/folders.routes';
import { decksRoutes } from './modules/decks/decks.routes';
import { cardTemplatesRoutes } from './modules/card-templates/card-templates.routes';
import { cardsRoutes } from './modules/cards/cards.routes';
import { studyRoutes } from './modules/study/study.routes';
import { notificationsRoutes } from './modules/notifications/notifications.routes';
import { feedbackRoutes } from './modules/feedback/feedback.routes';
import { usersRoutes } from './modules/users/users.routes';
import { importExportRoutes } from './modules/import-export/import-export.routes';
import { aiRoutes } from './modules/ai/ai.routes';
import {
  cleanupExpiredJobs,
  recoverOrphanedJobs,
} from './modules/ai/ai.service';

const AI_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000; // every hour

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidationError(
  error: unknown,
): error is { code: 'VALIDATION'; all?: unknown; message?: string } {
  return isRecord(error) && error.code === 'VALIDATION';
}

function getValidationErrorMessage(error: {
  all?: unknown;
  message?: string;
}): string {
  if (Array.isArray(error.all) && error.all.length > 0) {
    const firstIssue = error.all[0];
    if (isRecord(firstIssue)) {
      if (
        typeof firstIssue.summary === 'string' &&
        firstIssue.summary.length > 0
      ) {
        return firstIssue.summary;
      }
      if (
        typeof firstIssue.message === 'string' &&
        firstIssue.message.length > 0
      ) {
        return firstIssue.message;
      }
    }
  }
  return typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : 'Validation failed';
}

function toErrorInfo(error: unknown): {
  errorName: string;
  errorMessage: string;
  errorCode?: string;
  causeMessage?: string;
  causeCode?: string;
} {
  const compact = (value: string): string =>
    value.replace(/\s+/g, ' ').trim().slice(0, 500);

  const readCause = (
    cause: unknown,
  ): { causeMessage?: string; causeCode?: string } => {
    if (!isRecord(cause)) return {};
    return {
      causeMessage:
        typeof cause.message === 'string' ? compact(cause.message) : undefined,
      causeCode: typeof cause.code === 'string' ? cause.code : undefined,
    };
  };

  if (error instanceof Error) {
    const causeInfo = readCause((error as Error & { cause?: unknown }).cause);
    return {
      errorName: error.name || 'Error',
      errorMessage: compact(error.message || 'Unknown error'),
      errorCode:
        typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code?: string }).code
          : undefined,
      ...causeInfo,
    };
  }
  return {
    errorName: 'UnknownError',
    errorMessage: compact(String(error)),
  };
}

function isAiJobsSchemaNotReadyError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (typeof error.code !== 'string' || typeof error.message !== 'string') {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    (error.code === '42P01' && message.includes('ai_generation_jobs')) ||
    (error.code === '42703' &&
      message.includes('ai_generation_jobs') &&
      message.includes('error_message'))
  );
}

const app = new Elysia({ aot: true })
  .use(requestLoggerPlugin)
  .use(
    cors({
      origin:
        ENV.NODE_ENV === 'production'
          ? ENV.ALLOWED_ORIGINS
          : [/^http:\/\/localhost:\d+$/, ...ENV.ALLOWED_ORIGINS],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'x-timezone-offset'],
    }),
  )
  .onAfterHandle(({ set }) => {
    set.headers['X-Content-Type-Options'] = 'nosniff';
    set.headers['X-Frame-Options'] = 'DENY';
    set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
    set.headers['Permissions-Policy'] =
      'camera=(), microphone=(), geolocation=()';
  })
  .onError(({ error, set }) => {
    if (error instanceof AppError) {
      set.status = error.statusCode;
      return { error: error.message };
    }

    // Elysia validation errors
    if (isValidationError(error)) {
      set.status = 422;
      return { error: getValidationErrorMessage(error) };
    }

    if (
      isRecord(error) &&
      'message' in error &&
      error.message === 'Unauthorized'
    ) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }

    logger.error(toErrorInfo(error), 'Unhandled internal error');
    set.status = 500;
    return { error: 'Internal server error' };
  })
  .get('/health', async ({ set }) => {
    try {
      await db.execute(sql`SELECT 1`);
      return {
        status: 'ok',
        checks: { db: 'ok' },
        timestamp: new Date().toISOString(),
      };
    } catch {
      set.status = 503;
      return {
        status: 'degraded',
        checks: { db: 'error' },
        timestamp: new Date().toISOString(),
      };
    }
  })
  .use(authRoutes)
  .use(classesRoutes)
  .use(foldersRoutes)
  .use(decksRoutes)
  .use(cardTemplatesRoutes)
  .use(cardsRoutes)
  .use(studyRoutes)
  .use(notificationsRoutes)
  .use(feedbackRoutes)
  .use(usersRoutes)
  .use(importExportRoutes)
  .use(aiRoutes)
  .listen(ENV.PORT);

logger.info(
  { port: ENV.PORT, env: ENV.NODE_ENV },
  `API server running at http://localhost:${ENV.PORT}`,
);

// ── Background maintenance ─────────────────────────────────────────────────
// 1. Recover orphaned jobs first — any 'processing' row left over from a
//    previous server crash/restart will never complete. Mark them failed NOW
//    so the frontend stops polling and surfaces a clear error immediately.
// 2. Then run the regular 24h expiry cleanup.
let skipAiJobMaintenance = false;
(async () => {
  try {
    const { recovered } = await recoverOrphanedJobs();
    if (recovered > 0) {
      logger.warn(
        { recovered },
        'Marked orphaned AI generation jobs as failed (server restart recovery)',
      );
    }
  } catch (err) {
    if (isAiJobsSchemaNotReadyError(err)) {
      skipAiJobMaintenance = true;
      logger.warn(
        toErrorInfo(err),
        'Skipping AI job maintenance: ai_generation_jobs schema is not up to date (run db:migrate)',
      );
    } else {
      logger.error(
        toErrorInfo(err),
        'Failed to recover orphaned AI jobs on startup',
      );
    }
  }

  if (skipAiJobMaintenance) return;

  try {
    const result = await cleanupExpiredJobs();
    if (result.expired > 0) {
      logger.info(
        { expired: result.expired },
        'Cleaned up stale AI generation jobs on startup',
      );
    }
  } catch (err) {
    if (isAiJobsSchemaNotReadyError(err)) {
      skipAiJobMaintenance = true;
      logger.warn(
        toErrorInfo(err),
        'Skipping AI job maintenance: ai_generation_jobs schema is not up to date (run db:migrate)',
      );
    } else {
      logger.error(toErrorInfo(err), 'Failed to run initial AI job cleanup');
    }
  }
})();

const cleanupInterval = setInterval(async () => {
  if (skipAiJobMaintenance) return;

  try {
    const result = await cleanupExpiredJobs();
    if (result.expired > 0) {
      logger.info({ expired: result.expired }, 'Periodic AI job cleanup');
    }
  } catch (err) {
    if (isAiJobsSchemaNotReadyError(err)) {
      skipAiJobMaintenance = true;
      logger.warn(
        toErrorInfo(err),
        'Skipping AI job maintenance: ai_generation_jobs schema is not up to date (run db:migrate)',
      );
    } else {
      logger.error(toErrorInfo(err), 'Periodic AI job cleanup failed');
    }
  }
}, AI_CLEANUP_INTERVAL_MS);

// Unref so the interval never prevents the process from exiting gracefully
cleanupInterval.unref();

export type App = typeof app;
