import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { db as database } from '../../db';

const DEFAULT_BATCH_SIZE = 10;
// A batch sends sequentially, so the lease must cover the whole claimed batch
// rather than one SMTP call (the mail transport itself can wait up to 30s).
const DEFAULT_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 30 * 1000;
const DEFAULT_RETRY_BASE_MS = 5 * 1000;
const DEFAULT_RETRY_MAX_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const MAX_ERROR_CODE_LENGTH = 100;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const MAX_MESSAGE_ID_LENGTH = 500;

export type VerificationEmailExecutor = Pick<typeof database, 'execute'>;

export interface VerificationEmailJob {
  id: string;
  userId: string;
  tokenVersion: number;
  attemptCount: number;
  maxAttempts: number;
}

export interface VerificationEmailPayload {
  email: string;
  token: string;
}

export interface VerificationEmailDeliveryReceipt {
  messageId?: string;
}

export interface VerificationEmailFailure {
  code: string | null;
  message: string;
}

export interface VerificationEmailWorkerLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface VerificationEmailBatchDependencies {
  claimBatch(): Promise<VerificationEmailJob[]>;
  loadPayload(
    job: VerificationEmailJob,
  ): Promise<VerificationEmailPayload | null>;
  send(
    email: string,
    token: string,
  ): Promise<VerificationEmailDeliveryReceipt | void>;
  markSent(
    job: VerificationEmailJob,
    messageId: string | null,
  ): Promise<boolean>;
  markCancelled(job: VerificationEmailJob): Promise<boolean>;
  reschedule(
    job: VerificationEmailJob,
    failure: VerificationEmailFailure,
    delayMs: number,
  ): Promise<boolean>;
  markFailed(
    job: VerificationEmailJob,
    failure: VerificationEmailFailure,
  ): Promise<boolean>;
  logger: VerificationEmailWorkerLogger;
  random?: () => number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

export interface VerificationEmailBatchResult {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  cancelled: number;
  superseded: number;
  schemaUnavailable: boolean;
}

export interface VerificationEmailWorkerController {
  request(): void;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export interface VerificationEmailWorkerOptions {
  dependencies?: VerificationEmailBatchDependencies;
  pollIntervalMs?: number;
  processBatch?: () => Promise<VerificationEmailBatchResult | void>;
  onError?: (error: unknown) => void | Promise<void>;
}

type ClaimedJobRow = {
  id: string;
  userId: string;
  tokenVersion: number;
  attemptCount: number;
  maxAttempts: number;
};

type PayloadRow = {
  email: string;
  token: string;
};

type IdRow = {
  id: string;
};

let defaultDependenciesPromise:
  | Promise<VerificationEmailBatchDependencies>
  | undefined;
let schemaUnavailableWarningLogged = false;
let activeWorker: VerificationEmailWorkerController | null = null;

/**
 * Add or replace the single delivery job for a user.
 *
 * Call this with the same transaction that writes the user's token/version,
 * then call requestVerificationEmailProcessing() only after commit.
 */
export async function enqueueVerificationEmail(
  executor: VerificationEmailExecutor,
  userId: string,
  tokenVersion: number,
): Promise<{ jobId: string }> {
  const rows = await executor.execute<IdRow>(sql`
    INSERT INTO "email_verification_outbox" (
      "user_id",
      "token_version",
      "status",
      "attempt_count",
      "max_attempts",
      "next_attempt_at",
      "locked_by",
      "locked_until",
      "last_attempt_at",
      "last_error_code",
      "last_error",
      "message_id",
      "sent_at",
      "failed_at",
      "cancelled_at",
      "requested_at",
      "updated_at"
    )
    VALUES (
      ${userId},
      ${tokenVersion},
      'pending',
      0,
      ${DEFAULT_MAX_ATTEMPTS},
      now(),
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      now(),
      now()
    )
    ON CONFLICT ("user_id") DO UPDATE
    SET
      "token_version" = EXCLUDED."token_version",
      "status" = 'pending',
      "attempt_count" = 0,
      "max_attempts" = EXCLUDED."max_attempts",
      "next_attempt_at" = now(),
      "locked_by" = NULL,
      "locked_until" = NULL,
      "last_attempt_at" = NULL,
      "last_error_code" = NULL,
      "last_error" = NULL,
      "message_id" = NULL,
      "sent_at" = NULL,
      "failed_at" = NULL,
      "cancelled_at" = NULL,
      "requested_at" = now(),
      "updated_at" = now()
    WHERE
      "email_verification_outbox"."token_version"
        <= EXCLUDED."token_version"
    RETURNING "id"
  `);

  const row = rows[0];
  if (row) return { jobId: row.id };

  // A stale caller must not replace a newer queued token version. Return the
  // current job id so the surrounding transaction can finish harmlessly.
  const currentRows = await executor.execute<IdRow>(sql`
    SELECT "id"
    FROM "email_verification_outbox"
    WHERE "user_id" = ${userId}
    LIMIT 1
  `);
  const current = currentRows[0];
  if (!current) {
    throw new Error('Verification email outbox enqueue returned no job');
  }

  return { jobId: current.id };
}

/**
 * Cancel a pending or leased job after its matching verification token is no
 * longer usable. A worker already inside SMTP cannot be recalled, but all of
 * its later state changes are guarded by token-version/lease CAS predicates.
 */
export async function cancelVerificationEmail(
  executor: VerificationEmailExecutor,
  userId: string,
  tokenVersion: number,
): Promise<boolean> {
  const rows = await executor.execute<IdRow>(sql`
    UPDATE "email_verification_outbox"
    SET
      "status" = 'cancelled',
      "cancelled_at" = now(),
      "locked_by" = NULL,
      "locked_until" = NULL,
      "updated_at" = now()
    WHERE
      "user_id" = ${userId}
      AND "token_version" = ${tokenVersion}
      AND "status" IN ('pending', 'processing')
    RETURNING "id"
  `);

  return rows.length > 0;
}

function clampPositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

async function claimVerificationEmailBatch(
  executor: VerificationEmailExecutor,
  workerId: string,
  batchSize: number,
  leaseMs: number,
): Promise<VerificationEmailJob[]> {
  const limit = clampPositiveInteger(batchSize, DEFAULT_BATCH_SIZE);
  const leaseDuration = clampPositiveInteger(leaseMs, DEFAULT_LEASE_MS);
  const rows = await executor.execute<ClaimedJobRow>(sql`
    WITH claimable AS (
      SELECT "id"
      FROM "email_verification_outbox"
      WHERE
        (
          "status" = 'pending'
          AND "next_attempt_at" <= now()
        )
        OR (
          "status" = 'processing'
          AND (
            "locked_until" IS NULL
            OR "locked_until" <= now()
          )
        )
      ORDER BY
        COALESCE("locked_until", "next_attempt_at"),
        "requested_at",
        "id"
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "email_verification_outbox" AS outbox
    SET
      "status" = 'processing',
      "attempt_count" = outbox."attempt_count" + 1,
      "locked_by" = ${workerId},
      "locked_until" =
        now() + (
          ${leaseDuration}::double precision
          * interval '1 millisecond'
        ),
      "last_attempt_at" = now(),
      "updated_at" = now()
    FROM claimable
    WHERE outbox."id" = claimable."id"
    RETURNING
      outbox."id" AS "id",
      outbox."user_id" AS "userId",
      outbox."token_version" AS "tokenVersion",
      outbox."attempt_count" AS "attemptCount",
      outbox."max_attempts" AS "maxAttempts"
  `);

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    tokenVersion: Number(row.tokenVersion),
    attemptCount: Number(row.attemptCount),
    maxAttempts: Number(row.maxAttempts),
  }));
}

async function loadVerificationEmailPayload(
  executor: VerificationEmailExecutor,
  job: VerificationEmailJob,
): Promise<VerificationEmailPayload | null> {
  const rows = await executor.execute<PayloadRow>(sql`
    SELECT
      "email",
      "email_verification_token" AS "token"
    FROM "users"
    WHERE
      "id" = ${job.userId}
      AND "email_verified" = false
      AND "email_verification_version" = ${job.tokenVersion}
      AND "email_verification_token" IS NOT NULL
      AND "email_token_expires_at" IS NOT NULL
      AND "email_token_expires_at" > now()
    LIMIT 1
  `);

  return rows[0] ?? null;
}

async function markVerificationEmailSent(
  executor: VerificationEmailExecutor,
  workerId: string,
  job: VerificationEmailJob,
  messageId: string | null,
): Promise<boolean> {
  const rows = await executor.execute<IdRow>(sql`
    UPDATE "email_verification_outbox"
    SET
      "status" = 'sent',
      "message_id" = ${messageId},
      "sent_at" = now(),
      "locked_by" = NULL,
      "locked_until" = NULL,
      "last_error_code" = NULL,
      "last_error" = NULL,
      "updated_at" = now()
    WHERE
      "id" = ${job.id}
      AND "token_version" = ${job.tokenVersion}
      AND "status" = 'processing'
      AND "locked_by" = ${workerId}
    RETURNING "id"
  `);

  return rows.length > 0;
}

async function markVerificationEmailCancelled(
  executor: VerificationEmailExecutor,
  workerId: string,
  job: VerificationEmailJob,
): Promise<boolean> {
  const rows = await executor.execute<IdRow>(sql`
    UPDATE "email_verification_outbox"
    SET
      "status" = 'cancelled',
      "cancelled_at" = now(),
      "locked_by" = NULL,
      "locked_until" = NULL,
      "updated_at" = now()
    WHERE
      "id" = ${job.id}
      AND "token_version" = ${job.tokenVersion}
      AND "status" = 'processing'
      AND "locked_by" = ${workerId}
    RETURNING "id"
  `);

  return rows.length > 0;
}

async function rescheduleVerificationEmail(
  executor: VerificationEmailExecutor,
  workerId: string,
  job: VerificationEmailJob,
  failure: VerificationEmailFailure,
  delayMs: number,
): Promise<boolean> {
  const retryDelay = clampPositiveInteger(delayMs, DEFAULT_RETRY_BASE_MS);
  const rows = await executor.execute<IdRow>(sql`
    UPDATE "email_verification_outbox"
    SET
      "status" = 'pending',
      "next_attempt_at" =
        now() + (
          ${retryDelay}::double precision
          * interval '1 millisecond'
        ),
      "locked_by" = NULL,
      "locked_until" = NULL,
      "last_error_code" = ${failure.code},
      "last_error" = ${failure.message},
      "updated_at" = now()
    WHERE
      "id" = ${job.id}
      AND "token_version" = ${job.tokenVersion}
      AND "status" = 'processing'
      AND "locked_by" = ${workerId}
    RETURNING "id"
  `);

  return rows.length > 0;
}

async function markVerificationEmailFailed(
  executor: VerificationEmailExecutor,
  workerId: string,
  job: VerificationEmailJob,
  failure: VerificationEmailFailure,
): Promise<boolean> {
  const rows = await executor.execute<IdRow>(sql`
    UPDATE "email_verification_outbox"
    SET
      "status" = 'failed',
      "failed_at" = now(),
      "locked_by" = NULL,
      "locked_until" = NULL,
      "last_error_code" = ${failure.code},
      "last_error" = ${failure.message},
      "updated_at" = now()
    WHERE
      "id" = ${job.id}
      AND "token_version" = ${job.tokenVersion}
      AND "status" = 'processing'
      AND "locked_by" = ${workerId}
    RETURNING "id"
  `);

  return rows.length > 0;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

function sanitizeErrorCode(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const code = String(value)
    .replace(/[^A-Z0-9_.-]/gi, '')
    .slice(0, MAX_ERROR_CODE_LENGTH);
  return code || null;
}

function sanitizeErrorMessage(value: unknown): string {
  const raw =
    typeof value === 'string' && value
      ? value
      : 'Unknown verification email delivery error';

  const sanitized = raw
    .replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      '[REDACTED_EMAIL]',
    )
    .replace(
      /([?&](?:token|verifyToken|verificationToken)=)[^&\s]+/gi,
      '$1[REDACTED_TOKEN]',
    )
    .replace(/\b[a-f0-9]{64}\b/gi, '[REDACTED_TOKEN]')
    .replace(/\s+/g, ' ')
    .trim();

  return truncate(
    sanitized || 'Unknown verification email delivery error',
    MAX_ERROR_MESSAGE_LENGTH,
  );
}

function getVerificationEmailFailure(
  error: unknown,
): VerificationEmailFailure {
  if (error instanceof Error) {
    const details = error as Error & {
      code?: unknown;
      responseCode?: unknown;
    };
    return {
      code: sanitizeErrorCode(details.code ?? details.responseCode),
      message: sanitizeErrorMessage(error.message),
    };
  }

  return {
    code: null,
    message: sanitizeErrorMessage(undefined),
  };
}

function normalizeMessageId(
  receipt: VerificationEmailDeliveryReceipt | void,
): string | null {
  if (!receipt || typeof receipt.messageId !== 'string') return null;
  const value = receipt.messageId.trim();
  return value ? truncate(value, MAX_MESSAGE_ID_LENGTH) : null;
}

function getRetryDelayMs(
  attempt: number,
  random: () => number,
  baseMs: number,
  maxMs: number,
): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const normalizedBase = clampPositiveInteger(
    baseMs,
    DEFAULT_RETRY_BASE_MS,
  );
  const normalizedMax = Math.max(
    normalizedBase,
    clampPositiveInteger(maxMs, DEFAULT_RETRY_MAX_MS),
  );
  const exponential = Math.min(
    normalizedMax,
    normalizedBase * 2 ** Math.min(normalizedAttempt - 1, 30),
  );
  const randomSample = random();
  const randomValue = Number.isFinite(randomSample)
    ? Math.min(1, Math.max(0, randomSample))
    : 0.5;

  // Equal jitter: retain half the exponential delay and randomize the rest.
  return Math.floor(exponential / 2 + (exponential / 2) * randomValue);
}

function isSchemaUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === '42P01' || code === '42703';
}

function emptyBatchResult(
  overrides: Partial<VerificationEmailBatchResult> = {},
): VerificationEmailBatchResult {
  return {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    superseded: 0,
    schemaUnavailable: false,
    ...overrides,
  };
}

async function createDefaultDependencies(): Promise<VerificationEmailBatchDependencies> {
  const [{ db }, { sendVerificationEmail }, { logger }] = await Promise.all([
    import('../../db'),
    import('../../shared/email'),
    import('../../shared/logger'),
  ]);
  const workerId = randomUUID();
  const workerLogger = logger.child({ module: 'verification-email-worker' });

  return {
    claimBatch: () =>
      claimVerificationEmailBatch(
        db,
        workerId,
        DEFAULT_BATCH_SIZE,
        DEFAULT_LEASE_MS,
      ),
    loadPayload: (job) => loadVerificationEmailPayload(db, job),
    send: sendVerificationEmail,
    markSent: (job, messageId) =>
      markVerificationEmailSent(db, workerId, job, messageId),
    markCancelled: (job) =>
      markVerificationEmailCancelled(db, workerId, job),
    reschedule: (job, failure, delayMs) =>
      rescheduleVerificationEmail(
        db,
        workerId,
        job,
        failure,
        delayMs,
      ),
    markFailed: (job, failure) =>
      markVerificationEmailFailed(db, workerId, job, failure),
    logger: workerLogger,
  };
}

function getDefaultDependencies(): Promise<VerificationEmailBatchDependencies> {
  defaultDependenciesPromise ??= createDefaultDependencies();
  return defaultDependenciesPromise;
}

/**
 * Deliver one claimed batch sequentially.
 *
 * Claiming and every state transition are separate short database statements;
 * no database transaction or row lock is held while SMTP is in progress.
 * Delivery is intentionally at-least-once: a process crash after SMTP accepts
 * a message but before markSent commits can cause that message to be retried.
 */
export async function processVerificationEmailBatch(
  dependencies?: VerificationEmailBatchDependencies,
): Promise<VerificationEmailBatchResult> {
  const deps = dependencies ?? (await getDefaultDependencies());
  const result = emptyBatchResult();
  let jobs: VerificationEmailJob[];

  try {
    jobs = await deps.claimBatch();
  } catch (error) {
    if (!isSchemaUnavailableError(error)) throw error;

    if (!schemaUnavailableWarningLogged) {
      schemaUnavailableWarningLogged = true;
      deps.logger.warn(
        {
          errorCode: sanitizeErrorCode(
            (error as { code?: unknown }).code,
          ),
        },
        'Verification email outbox schema is unavailable; worker will retry',
      );
    }

    return emptyBatchResult({ schemaUnavailable: true });
  }

  result.claimed = jobs.length;

  for (const job of jobs) {
    try {
      // A crashed worker may leave its final allowed attempt in processing.
      // Reclaim increments the counter, so close that job without a sixth SMTP
      // call instead of leaving it leased forever or exceeding maxAttempts.
      if (job.attemptCount > job.maxAttempts) {
        const failure: VerificationEmailFailure = {
          code: 'MAX_ATTEMPTS_EXHAUSTED',
          message: 'Maximum verification email delivery attempts exhausted',
        };
        if (await deps.markFailed(job, failure)) {
          result.failed += 1;
          deps.logger.error(
            {
              jobId: job.id,
              userId: job.userId,
              attempt: job.attemptCount,
            },
            'Verification email delivery permanently failed',
          );
        } else {
          result.superseded += 1;
        }
        continue;
      }

      const payload = await deps.loadPayload(job);
      if (!payload) {
        if (await deps.markCancelled(job)) {
          result.cancelled += 1;
        } else {
          result.superseded += 1;
        }
        continue;
      }

      try {
        const receipt = await deps.send(payload.email, payload.token);
        if (await deps.markSent(job, normalizeMessageId(receipt))) {
          result.sent += 1;
        } else {
          result.superseded += 1;
        }
      } catch (error) {
        const failure = getVerificationEmailFailure(error);
        if (job.attemptCount >= job.maxAttempts) {
          if (await deps.markFailed(job, failure)) {
            result.failed += 1;
            deps.logger.error(
              {
                jobId: job.id,
                userId: job.userId,
                attempt: job.attemptCount,
              },
              'Verification email delivery permanently failed',
            );
          } else {
            result.superseded += 1;
          }
          continue;
        }

        const delayMs = getRetryDelayMs(
          job.attemptCount,
          deps.random ?? Math.random,
          deps.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
          deps.retryMaxMs ?? DEFAULT_RETRY_MAX_MS,
        );
        if (await deps.reschedule(job, failure, delayMs)) {
          result.retried += 1;
          deps.logger.warn(
            {
              jobId: job.id,
              userId: job.userId,
              attempt: job.attemptCount,
              errorCode: failure.code,
              errorMessage: failure.message,
            },
            'Verification email delivery will be retried',
          );
        } else {
          result.superseded += 1;
        }
      }
    } catch (error) {
      const failure = getVerificationEmailFailure(error);
      deps.logger.warn(
        {
          jobId: job.id,
          userId: job.userId,
          attempt: job.attemptCount,
          errorCode: failure.code,
          errorMessage: failure.message,
        },
        'Verification email job could not persist its state transition',
      );
    }
  }

  return result;
}

async function logWorkerLoopError(error: unknown): Promise<void> {
  const { logger } = await import('../../shared/logger');
  logger.error(
    {
      module: 'verification-email-worker',
      errorCode: sanitizeErrorCode(
        (error as { code?: unknown } | null)?.code,
      ),
    },
    'Verification email worker batch failed',
  );
}

/**
 * Create a self-scheduling worker. request() calls are coalesced, and a second
 * batch can never overlap an in-flight batch in this controller.
 */
export function createVerificationEmailWorker(
  options: VerificationEmailWorkerOptions = {},
): VerificationEmailWorkerController {
  const pollIntervalMs = clampPositiveInteger(
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
  );
  const runBatch =
    options.processBatch ??
    (() => processVerificationEmailBatch(options.dependencies));
  const onError = options.onError ?? logWorkerLoopError;

  let stopped = false;
  let requested = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let drainPromise: Promise<void> | null = null;

  const clearPollTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const schedulePoll = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      controller.request();
    }, pollIntervalMs);
    timer.unref?.();
  };

  const drain = async () => {
    try {
      while (requested && !stopped) {
        requested = false;
        try {
          const batchResult = await runBatch();
          if (batchResult && batchResult.claimed > 0) {
            requested = true;
          }
        } catch (error) {
          try {
            await onError(error);
          } catch {
            // A logger failure must not turn this detached worker into an
            // unhandled rejection.
          }
        }
      }
    } finally {
      drainPromise = null;
      if (!stopped && requested) {
        launch();
      } else {
        schedulePoll();
      }
    }
  };

  const launch = () => {
    if (stopped || drainPromise) return;
    drainPromise = drain();
  };

  const controller: VerificationEmailWorkerController = {
    request() {
      if (stopped) return;
      requested = true;
      clearPollTimer();
      launch();
    },
    async stop() {
      stopped = true;
      requested = false;
      clearPollTimer();
      await drainPromise;
    },
    isRunning() {
      return drainPromise !== null;
    },
  };

  return controller;
}

/**
 * Start the process-wide worker used by the API runtime. Calling this twice is
 * idempotent and returns the existing controller.
 */
export function startVerificationEmailWorker(
  options: VerificationEmailWorkerOptions = {},
): VerificationEmailWorkerController {
  if (activeWorker) return activeWorker;

  const worker = createVerificationEmailWorker(options);
  const originalStop = worker.stop;
  const controller: VerificationEmailWorkerController = {
    request: worker.request,
    isRunning: worker.isRunning,
    async stop() {
      await originalStop();
      if (activeWorker === controller) activeWorker = null;
    },
  };

  activeWorker = controller;
  controller.request();
  return controller;
}

/**
 * Wake the singleton after an enqueue transaction commits. Multiple wake-ups
 * during one active batch collapse into one additional drain pass.
 */
export function requestVerificationEmailProcessing(): void {
  if (!activeWorker) {
    return;
  }

  activeWorker.request();
}
