import Elysia from 'elysia';
import { logger } from '../shared/logger';

/**
 * HTTP Request / Response logger plugin.
 *
 * Logs every request on completion with:
 *   method · path · status · duration (ms) · ip
 *
 * Timing: `derive` captures performance.now() once per request in the
 * transform phase. This covers handler execution + all middleware time.
 * The derived `_startTime` property flows into onAfterHandle / onError.
 *
 * Performance: serialisation is off-thread (pino-pretty worker in dev;
 * raw JSON stdout in production). Handler overhead < 1 µs.
 */

function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

function getPathWithQuery(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function toErrorInfo(error: unknown): {
  errorName: string;
  errorMessage: string;
  errorCode?: string;
} {
  if (error instanceof Error) {
    return {
      errorName: error.name || 'Error',
      errorMessage: error.message || 'Unknown error',
      errorCode:
        typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code?: string }).code
          : undefined,
    };
  }
  return {
    errorName: 'UnknownError',
    errorMessage: String(error),
  };
}

export const requestLoggerPlugin = new Elysia({ name: 'request-logger' })
  // derive runs once per request before any handler — captures timing/context
  .derive({ as: 'global' }, ({ request }) => {
    const requestId =
      request.headers.get('x-request-id') ?? crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const path = getPathWithQuery(request);
    logger.info(
      {
        requestId,
        method: request.method,
        path,
        ip: getClientIp(request),
        startedAt,
      },
      `Started ${request.method} "${path}"`,
    );
    return {
      _requestId: requestId,
      _startTime: performance.now(),
      _startedAt: startedAt,
    };
  })
  .onAfterHandle(
    { as: 'global' },
    ({ request, set, _startTime, _requestId }) => {
      const path = getPathWithQuery(request);
      const duration = Math.round((performance.now() - _startTime) * 100) / 100;
      const status = (set.status ?? 200) as number;

      const logFn =
        status >= 500
          ? logger.error.bind(logger)
          : status >= 400
            ? logger.warn.bind(logger)
            : logger.info.bind(logger);

      logFn(
        {
          requestId: _requestId,
          method: request.method,
          path,
          status,
          duration,
          ip: getClientIp(request),
        },
        `Completed ${status} in ${duration}ms`,
      );
    },
  )
  .onError(
    {
      as: 'global',
    },
    ({ request, error, set, _startTime, _requestId }) => {
      const path = getPathWithQuery(request);
      const duration =
        _startTime != null
          ? Math.round((performance.now() - _startTime) * 100) / 100
          : -1;
      const status = (set.status ?? 500) as number;
      const errorInfo = toErrorInfo(error);
      const logData = {
        requestId: _requestId,
        method: request.method,
        path,
        status,
        duration,
        ip: getClientIp(request),
        ...errorInfo,
      };

      if (status >= 500) {
        logger.error(logData, `Failed ${status} in ${duration}ms`);
      } else {
        // 4xx are client errors — log at warn, no stack trace needed
        logger.warn(logData, `Failed ${status} in ${duration}ms`);
      }
    },
  );
