import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';

import type { db as database } from '../../db';
import { AppError } from '../../shared/errors';

const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_RETRY_BASE_MS = 2_000;
const DEFAULT_RETRY_MAX_MS = 5 * 60_000;
const MAX_CLAIMED_ATTEMPTS = 5;
const MAX_ERROR_CODE_LENGTH = 100;

export type KgRunStage =
  | 'snapshot'
  | 'indexing'
  | 'embeddings'
  | 'candidates'
  | 'verification'
  | 'persistence';

export type KgTerminalOutcome = 'completed' | 'partial' | 'stale';

export type ClaimedKgRun = {
  id: string;
  userId: string;
  runType: 'deck_index' | 'sense_expansion';
  deckId: string | null;
  focusSenseId: string | null;
  stage: KgRunStage;
  fingerprint: string;
  representationVersion: string;
  embeddingModel: string;
  promptVersion: string;
  taxonomyVersion: string;
  sourceLanguageTag: string;
  definitionLanguageTag: string;
  snapshot: Record<string, unknown>;
  progress: Record<string, unknown>;
  stats: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  cancelRequestedAt: string | null;
};

export type KgWorkerFailure = {
  code: string | null;
  message: string;
};

export type KgOwnershipStatus = {
  owned: boolean;
  cancelRequested: boolean;
};

export type KgRunRepository = {
  recoverAbandoned(): Promise<{ cancelled: number; failed: number }>;
  loadQueueTelemetry(): Promise<{
    depth: number;
    oldestAgeMs: number | null;
  }>;
  claimBatch(
    workerId: string,
    batchSize: number,
    leaseMs: number,
  ): Promise<ClaimedKgRun[]>;
  heartbeat(
    runId: string,
    workerId: string,
    leaseMs: number,
  ): Promise<KgOwnershipStatus>;
  advanceStage(
    runId: string,
    workerId: string,
    expectedStage: KgRunStage,
    stage: KgRunStage,
    progress?: Record<string, unknown>,
    statsPatch?: Record<string, unknown>,
  ): Promise<boolean>;
  saveSnapshotAndAdvance(
    runId: string,
    workerId: string,
    expectedStage: KgRunStage,
    snapshot: Record<string, unknown>,
    stage: KgRunStage,
    progress?: Record<string, unknown>,
    statsPatch?: Record<string, unknown>,
  ): Promise<boolean>;
  finish(
    runId: string,
    workerId: string,
    expectedStage: KgRunStage,
    outcome: KgTerminalOutcome,
    progress?: Record<string, unknown>,
    statsPatch?: Record<string, unknown>,
  ): Promise<boolean>;
  retry(
    runId: string,
    workerId: string,
    expectedStage: KgRunStage,
    failure: KgWorkerFailure,
    delayMs: number,
  ): Promise<boolean>;
  fail(
    runId: string,
    workerId: string,
    expectedStage: KgRunStage,
    failure: KgWorkerFailure,
  ): Promise<boolean>;
  cancel(
    runId: string,
    workerId: string,
    expectedStage: KgRunStage,
  ): Promise<boolean>;
  finalizeCancellation(
    runId: string,
    workerId: string,
    expectedStage: KgRunStage,
  ): Promise<boolean>;
};

export type KgStageExecutionContext = {
  run: ClaimedKgRun;
  workerId: string;
  signal: AbortSignal;
  advanceStage(
    stage: KgRunStage,
    progress?: Record<string, unknown>,
    statsPatch?: Record<string, unknown>,
  ): Promise<boolean>;
  saveSnapshotAndAdvance(
    snapshot: Record<string, unknown>,
    stage: KgRunStage,
    progress?: Record<string, unknown>,
    statsPatch?: Record<string, unknown>,
  ): Promise<boolean>;
  heartbeat(): Promise<boolean>;
};

export type KgStageExecutionResult = {
  outcome: KgTerminalOutcome;
  progress?: Record<string, unknown>;
  statsPatch?: Record<string, unknown>;
};

export type KgStageExecutor = (
  context: KgStageExecutionContext,
) => Promise<KgStageExecutionResult>;

export type KgWorkerLogger = {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
};

type TimerHandle = {
  unref?: () => void;
};

export type KgWorkerTimers = {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, delayMs: number): TimerHandle;
  clearInterval(handle: unknown): void;
};

export type KgWorkerDependencies = {
  workerId: string;
  repository: KgRunRepository;
  execute: KgStageExecutor;
  logger: KgWorkerLogger;
  random?: () => number;
  batchSize?: number;
  leaseMs?: number;
  heartbeatIntervalMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  timers?: KgWorkerTimers;
  now?: () => number;
};

export type KgWorkerBatchResult = {
  claimed: number;
  completed: number;
  partial: number;
  stale: number;
  retried: number;
  failed: number;
  cancelled: number;
  superseded: number;
};

export type KgWorkerController = {
  request(): void;
  stop(): Promise<void>;
  isRunning(): boolean;
};

export type KgWorkerOptions = {
  dependencies?: KgWorkerDependencies;
  pollIntervalMs?: number;
  processBatch?: () => Promise<KgWorkerBatchResult>;
  onError?: (error: unknown) => void | Promise<void>;
  timers?: KgWorkerTimers;
  yieldControl?: () => Promise<void>;
};

export type KgWorkerExecutor = Pick<typeof database, 'execute'>;

type ClaimedKgRunRow = Omit<
  ClaimedKgRun,
  'attemptCount' | 'maxAttempts' | 'cancelRequestedAt'
> & {
  attemptCount: number | string;
  maxAttempts: number | string;
  cancelRequestedAt: Date | string | null;
};

type OwnershipRow = {
  cancelRequestedAt: Date | string | null;
};

type IdRow = {
  id: string;
};

type RecoveryRow = {
  cancelled: number | string;
  failed: number | string;
};

type QueueTelemetryRow = {
  depth: number | string;
  oldestAgeMs: number | string | null;
};

class KgOwnershipLostError extends Error {
  constructor() {
    super('KG run ownership lost');
    this.name = 'KgOwnershipLostError';
  }
}

class KgCancellationRequestedError extends Error {
  constructor() {
    super('KG run cancellation requested');
    this.name = 'KgCancellationRequestedError';
  }
}

let defaultDependenciesPromise: Promise<KgWorkerDependencies> | undefined;
let activeWorker: KgWorkerController | null = null;

function positiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function emptyBatchResult(): KgWorkerBatchResult {
  return {
    claimed: 0,
    completed: 0,
    partial: 0,
    stale: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    superseded: 0,
  };
}

function defaultTimers(): KgWorkerTimers {
  return {
    setTimeout(callback, delayMs) {
      return setTimeout(callback, delayMs);
    },
    clearTimeout(handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    setInterval(callback, delayMs) {
      return setInterval(callback, delayMs);
    },
    clearInterval(handle) {
      clearInterval(handle as ReturnType<typeof setInterval>);
    },
  };
}

function sanitizeErrorCode(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, MAX_ERROR_CODE_LENGTH) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function findHttpStatus(error: unknown, depth = 0): number | null {
  if (!isRecord(error) || depth > 4) return null;
  for (const value of [error.status, error.statusCode, error.code]) {
    const status =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\d{3}$/.test(value)
          ? Number(value)
          : null;
    if (status && status >= 100 && status <= 599) return status;
  }
  const responseStatus = isRecord(error.response)
    ? findHttpStatus(error.response, depth + 1)
    : null;
  return responseStatus ?? findHttpStatus(error.cause, depth + 1);
}

function findAppError(
  error: unknown,
  seen = new Set<unknown>(),
): AppError | null {
  if (error instanceof AppError) return error;
  if (!isRecord(error) || seen.has(error)) return null;
  seen.add(error);
  return findAppError(error.cause, seen);
}

function deterministicFailure(error: unknown): KgWorkerFailure {
  const appError = findAppError(error);
  if (appError) {
    if (appError.statusCode === 404) {
      return {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Knowledge graph resource not found',
      };
    }
    if (appError.statusCode === 422) {
      return {
        code: 'VALIDATION_ERROR',
        message: 'Knowledge graph validation failed',
      };
    }
    return {
      code: 'APPLICATION_ERROR',
      message: 'Knowledge graph application operation failed',
    };
  }

  const code = isRecord(error) ? sanitizeErrorCode(error.code) : null;
  if (code === 'KG_EXECUTOR_UNAVAILABLE') {
    return {
      code,
      message: 'Knowledge graph executor unavailable',
    };
  }
  if (code === 'MALFORMED_RESPONSE') {
    return {
      code,
      message: 'Knowledge graph provider response was malformed',
    };
  }
  if (code && /^(22|23|42)/.test(code)) {
    return {
      code: 'KG_PERSISTENCE_ERROR',
      message: 'Knowledge graph persistence validation failed',
    };
  }
  return {
    code: 'KG_EXECUTION_ERROR',
    message: 'Knowledge graph execution failed',
  };
}

function getFailure(error: unknown): {
  failure: KgWorkerFailure;
  retryable: boolean;
} {
  if (findAppError(error)) {
    return {
      retryable: false,
      failure: deterministicFailure(error),
    };
  }

  const status = findHttpStatus(error);
  const retryable =
    status === 429 || (status !== null && status >= 500 && status <= 599);
  if (retryable) {
    return {
      retryable: true,
      failure: {
        code: `PROVIDER_HTTP_${status}`,
        message: `Transient provider request failed (HTTP ${status})`,
      },
    };
  }

  return {
    retryable: false,
    failure: deterministicFailure(error),
  };
}

function retryDelayMs(
  attempt: number,
  random: () => number,
  baseMs: number,
  maxMs: number,
): number {
  const exponential = baseMs * 2 ** Math.max(0, attempt - 1);
  const jitter = 0.5 + Math.min(1, Math.max(0, random()));
  return Math.min(maxMs, Math.max(1, Math.round(exponential * jitter)));
}

function json(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {});
}

function mapClaimedRun(row: ClaimedKgRunRow): ClaimedKgRun {
  return {
    ...row,
    attemptCount: Number(row.attemptCount),
    maxAttempts: Number(row.maxAttempts),
    cancelRequestedAt: row.cancelRequestedAt
      ? new Date(row.cancelRequestedAt).toISOString()
      : null,
  };
}

function terminalTimestamp(outcome: KgTerminalOutcome) {
  if (outcome === 'completed') return sql`"completed_at" = now(),`;
  if (outcome === 'partial') return sql`"partial_at" = now(),`;
  return sql`"stale_at" = now(),`;
}

export function createPostgresKgRunRepository(
  executor: KgWorkerExecutor,
): KgRunRepository {
  return {
    async recoverAbandoned() {
      const rows = await executor.execute<RecoveryRow>(sql`
        WITH cancelled AS (
          UPDATE "kg_runs"
          SET
            "status" = 'cancelled',
            "cancelled_at" = COALESCE("cancelled_at", now()),
            "locked_by" = NULL,
            "locked_until" = NULL,
            "heartbeat_at" = NULL,
            "updated_at" = now()
          WHERE
            (
              "status" = 'queued'
              AND "cancel_requested_at" IS NOT NULL
            )
            OR (
              "status" = 'processing'
              AND "cancel_requested_at" IS NOT NULL
              AND "locked_until" <= now()
            )
          RETURNING 1
        ),
        exhausted AS (
          UPDATE "kg_runs"
          SET
            "status" = 'failed',
            "failed_at" = COALESCE("failed_at", now()),
            "error_code" = 'MAX_ATTEMPTS_EXHAUSTED',
            "error_message" = 'Maximum knowledge graph attempts exhausted',
            "locked_by" = NULL,
            "locked_until" = NULL,
            "heartbeat_at" = NULL,
            "updated_at" = now()
          WHERE
            "status" = 'processing'
            AND "cancel_requested_at" IS NULL
            AND "locked_until" <= now()
            AND "attempt_count" >=
              LEAST("max_attempts", ${MAX_CLAIMED_ATTEMPTS})
          RETURNING 1
        )
        SELECT
          (SELECT count(*) FROM cancelled) AS "cancelled",
          (SELECT count(*) FROM exhausted) AS "failed"
      `);
      return {
        cancelled: Number(rows[0]?.cancelled ?? 0),
        failed: Number(rows[0]?.failed ?? 0),
      };
    },

    async loadQueueTelemetry() {
      const rows = await executor.execute<QueueTelemetryRow>(sql`
        SELECT
          count(*) AS "depth",
          CASE
            WHEN min("created_at") IS NULL THEN NULL
            ELSE GREATEST(
              0,
              round(
                EXTRACT(EPOCH FROM (now() - min("created_at"))) * 1000
              )
            )
          END AS "oldestAgeMs"
        FROM "kg_runs"
        WHERE
          "cancel_requested_at" IS NULL
          AND "attempt_count" <
            LEAST("max_attempts", ${MAX_CLAIMED_ATTEMPTS})
          AND (
            (
              "status" = 'queued'
              AND "next_attempt_at" <= now()
            )
            OR (
              "status" = 'processing'
              AND "locked_until" <= now()
            )
          )
      `);
      const row = rows[0];
      return {
        depth: Number(row?.depth ?? 0),
        oldestAgeMs:
          row?.oldestAgeMs === null || row?.oldestAgeMs === undefined
            ? null
            : Number(row.oldestAgeMs),
      };
    },

    async claimBatch(workerId, batchSize, leaseMs) {
      const limit = positiveInteger(batchSize, DEFAULT_BATCH_SIZE);
      const leaseDuration = positiveInteger(leaseMs, DEFAULT_LEASE_MS);
      const rows = await executor.execute<ClaimedKgRunRow>(sql`
        WITH claimable AS (
          SELECT "id"
          FROM "kg_runs"
          WHERE
            "cancel_requested_at" IS NULL
            AND "attempt_count" < LEAST("max_attempts", ${MAX_CLAIMED_ATTEMPTS})
            AND (
              (
                "status" = 'queued'
                AND "next_attempt_at" <= now()
              )
              OR (
                "status" = 'processing'
                AND "locked_until" <= now()
              )
            )
          ORDER BY "created_at", "id"
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE "kg_runs" AS run
        SET
          "status" = 'processing',
          "locked_by" = ${workerId}::uuid,
          "locked_until" =
            now() + (
              ${leaseDuration}::double precision * interval '1 millisecond'
            ),
          "heartbeat_at" = now(),
          "started_at" = COALESCE(run."started_at", now()),
          "attempt_count" = run."attempt_count" + 1,
          "error_code" = NULL,
          "error_message" = NULL,
          "updated_at" = now()
        FROM claimable
        WHERE run."id" = claimable."id"
        RETURNING
          run."id" AS "id",
          run."user_id" AS "userId",
          run."run_type" AS "runType",
          run."deck_id" AS "deckId",
          run."focus_sense_id" AS "focusSenseId",
          run."stage" AS "stage",
          run."fingerprint" AS "fingerprint",
          run."representation_version" AS "representationVersion",
          run."embedding_model" AS "embeddingModel",
          run."prompt_version" AS "promptVersion",
          run."taxonomy_version" AS "taxonomyVersion",
          run."source_language_tag" AS "sourceLanguageTag",
          run."definition_language_tag" AS "definitionLanguageTag",
          run."snapshot" AS "snapshot",
          run."progress" AS "progress",
          run."stats" AS "stats",
          run."attempt_count" AS "attemptCount",
          run."max_attempts" AS "maxAttempts",
          run."cancel_requested_at" AS "cancelRequestedAt"
      `);
      return rows.map(mapClaimedRun);
    },

    async heartbeat(runId, workerId, leaseMs) {
      const leaseDuration = positiveInteger(leaseMs, DEFAULT_LEASE_MS);
      const rows = await executor.execute<OwnershipRow>(sql`
        UPDATE "kg_runs"
        SET
          "locked_until" =
            now() + (
              ${leaseDuration}::double precision * interval '1 millisecond'
            ),
          "heartbeat_at" = now()
        WHERE
          "id" = ${runId}::uuid
          AND "status" = 'processing'
          AND "locked_by" = ${workerId}::uuid
        RETURNING "cancel_requested_at" AS "cancelRequestedAt"
      `);
      const row = rows[0];
      return {
        owned: Boolean(row),
        cancelRequested: Boolean(row?.cancelRequestedAt),
      };
    },

    async advanceStage(
      runId,
      workerId,
      expectedStage,
      stage,
      progress,
      statsPatch,
    ) {
      const rows = await executor.execute<IdRow>(sql`
        UPDATE "kg_runs"
        SET
          "stage" = ${stage},
          "progress" = "progress" || ${json(progress)}::jsonb,
          "stats" = "stats" || ${json(statsPatch)}::jsonb,
          "updated_at" = now()
        WHERE
          "id" = ${runId}::uuid
          AND "status" = 'processing'
          AND "locked_by" = ${workerId}::uuid
          AND "stage" = ${expectedStage}
          AND "cancel_requested_at" IS NULL
        RETURNING "id"
      `);
      return rows.length === 1;
    },

    async saveSnapshotAndAdvance(
      runId,
      workerId,
      expectedStage,
      snapshot,
      stage,
      progress,
      statsPatch,
    ) {
      const rows = await executor.execute<IdRow>(sql`
        UPDATE "kg_runs"
        SET
          "snapshot" = ${json(snapshot)}::jsonb,
          "stage" = ${stage},
          "progress" = "progress" || ${json(progress)}::jsonb,
          "stats" = "stats" || ${json(statsPatch)}::jsonb,
          "updated_at" = now()
        WHERE
          "id" = ${runId}::uuid
          AND "status" = 'processing'
          AND "locked_by" = ${workerId}::uuid
          AND "stage" = ${expectedStage}
          AND "cancel_requested_at" IS NULL
        RETURNING "id"
      `);
      return rows.length === 1;
    },

    async finish(
      runId,
      workerId,
      expectedStage,
      outcome,
      progress,
      statsPatch,
    ) {
      const rows = await executor.execute<IdRow>(sql`
        UPDATE "kg_runs"
        SET
          "status" = ${outcome},
          ${terminalTimestamp(outcome)}
          "progress" = "progress" || ${json(progress)}::jsonb,
          "stats" = "stats" || ${json(statsPatch)}::jsonb,
          "locked_by" = NULL,
          "locked_until" = NULL,
          "heartbeat_at" = NULL,
          "updated_at" = now()
        WHERE
          "id" = ${runId}::uuid
          AND "status" = 'processing'
          AND "locked_by" = ${workerId}::uuid
          AND "stage" = ${expectedStage}
          AND "cancel_requested_at" IS NULL
        RETURNING "id"
      `);
      return rows.length === 1;
    },

    async retry(runId, workerId, expectedStage, failure, delayMs) {
      const delay = positiveInteger(delayMs, DEFAULT_RETRY_BASE_MS);
      const rows = await executor.execute<IdRow>(sql`
        UPDATE "kg_runs"
        SET
          "status" = 'queued',
          "next_attempt_at" =
            now() + (${delay}::double precision * interval '1 millisecond'),
          "error_code" = ${failure.code},
          "error_message" = ${failure.message},
          "locked_by" = NULL,
          "locked_until" = NULL,
          "heartbeat_at" = NULL,
          "updated_at" = now()
        WHERE
          "id" = ${runId}::uuid
          AND "status" = 'processing'
          AND "locked_by" = ${workerId}::uuid
          AND "stage" = ${expectedStage}
          AND "cancel_requested_at" IS NULL
        RETURNING "id"
      `);
      return rows.length === 1;
    },

    async fail(runId, workerId, expectedStage, failure) {
      const rows = await executor.execute<IdRow>(sql`
        UPDATE "kg_runs"
        SET
          "status" = 'failed',
          "failed_at" = now(),
          "error_code" = ${failure.code},
          "error_message" = ${failure.message},
          "locked_by" = NULL,
          "locked_until" = NULL,
          "heartbeat_at" = NULL,
          "updated_at" = now()
        WHERE
          "id" = ${runId}::uuid
          AND "status" = 'processing'
          AND "locked_by" = ${workerId}::uuid
          AND "stage" = ${expectedStage}
          AND "cancel_requested_at" IS NULL
        RETURNING "id"
      `);
      return rows.length === 1;
    },

    async cancel(runId, workerId, expectedStage) {
      const rows = await executor.execute<IdRow>(sql`
        UPDATE "kg_runs"
        SET
          "status" = 'cancelled',
          "cancelled_at" = now(),
          "locked_by" = NULL,
          "locked_until" = NULL,
          "heartbeat_at" = NULL,
          "updated_at" = now()
        WHERE
          "id" = ${runId}::uuid
          AND "status" = 'processing'
          AND "locked_by" = ${workerId}::uuid
          AND "stage" = ${expectedStage}
        RETURNING "id"
      `);
      return rows.length === 1;
    },

    async finalizeCancellation(runId, workerId, expectedStage) {
      const rows = await executor.execute<IdRow>(sql`
        UPDATE "kg_runs"
        SET
          "status" = 'cancelled',
          "cancelled_at" = COALESCE("cancelled_at", now()),
          "locked_by" = NULL,
          "locked_until" = NULL,
          "heartbeat_at" = NULL,
          "updated_at" = now()
        WHERE
          "id" = ${runId}::uuid
          AND "status" = 'processing'
          AND "locked_by" = ${workerId}::uuid
          AND "stage" = ${expectedStage}
          AND "cancel_requested_at" IS NOT NULL
        RETURNING "id"
      `);
      return rows.length === 1;
    },
  };
}

export async function requestKgRunCancellation(
  executor: KgWorkerExecutor,
  runId: string,
  userId: string,
): Promise<'cancelled' | 'requested' | 'not_found'> {
  const rows = await executor.execute<{ status: 'cancelled' | 'processing' }>(
    sql`
      UPDATE "kg_runs"
      SET
        "cancel_requested_at" = COALESCE("cancel_requested_at", now()),
        "status" =
          CASE WHEN "status" = 'queued' THEN 'cancelled' ELSE "status" END,
        "cancelled_at" =
          CASE
            WHEN "status" = 'queued' THEN COALESCE("cancelled_at", now())
            ELSE "cancelled_at"
          END,
        "locked_by" =
          CASE WHEN "status" = 'queued' THEN NULL ELSE "locked_by" END,
        "locked_until" =
          CASE WHEN "status" = 'queued' THEN NULL ELSE "locked_until" END,
        "heartbeat_at" =
          CASE WHEN "status" = 'queued' THEN NULL ELSE "heartbeat_at" END,
        "updated_at" = now()
      WHERE
        "id" = ${runId}::uuid
        AND "user_id" = ${userId}::uuid
        AND "status" IN ('queued', 'processing')
      RETURNING "status"
    `,
  );
  const status = rows[0]?.status;
  if (!status) return 'not_found';
  return status === 'cancelled' ? 'cancelled' : 'requested';
}

async function processClaimedRun(
  run: ClaimedKgRun,
  dependencies: KgWorkerDependencies,
  result: KgWorkerBatchResult,
): Promise<void> {
  const leaseMs = positiveInteger(dependencies.leaseMs, DEFAULT_LEASE_MS);
  const heartbeatIntervalMs = Math.min(
    positiveInteger(
      dependencies.heartbeatIntervalMs,
      Math.max(1, Math.floor(leaseMs / 3)),
    ),
    Math.max(1, Math.floor(leaseMs / 3)),
  );
  const timers = dependencies.timers ?? defaultTimers();
  const now = dependencies.now ?? (() => performance.now());
  const controller = new AbortController();
  let stage = run.stage;
  let stageStartedAt = now();
  let cancellationObserved = Boolean(run.cancelRequestedAt);
  let ownershipLost = false;
  let heartbeatHandle: TimerHandle | null = null;
  let heartbeatPromise: Promise<boolean> | null = null;

  const context = (transition?: string, extra: Record<string, unknown> = {}) => ({
    runId: run.id,
    workerId: dependencies.workerId,
    attempt: run.attemptCount,
    stage,
    transition,
    ...extra,
  });
  const stageDurationMs = (endedAt = now()) =>
    Math.max(0, Math.round(endedAt - stageStartedAt));

  const cancelOwnedRun = async () => {
    if (ownershipLost) return false;
    const cancelled = await dependencies.repository.cancel(
      run.id,
      dependencies.workerId,
      stage,
    );
    if (cancelled) {
      cancellationObserved = true;
      controller.abort(new KgCancellationRequestedError());
    } else {
      ownershipLost = true;
      controller.abort(new KgOwnershipLostError());
    }
    return cancelled;
  };

  const finalizeCancellationAfterCasLoss = async () => {
    const cancelled = await dependencies.repository.finalizeCancellation(
      run.id,
      dependencies.workerId,
      stage,
    );
    if (cancelled) {
      cancellationObserved = true;
      controller.abort(new KgCancellationRequestedError());
      return true;
    }
    ownershipLost = true;
    controller.abort(new KgOwnershipLostError());
    return false;
  };

  const maintainOwnership = (): Promise<boolean> => {
    if (ownershipLost || cancellationObserved) return Promise.resolve(false);
    if (heartbeatPromise) return heartbeatPromise;
    heartbeatPromise = (async () => {
      const status = await dependencies.repository.heartbeat(
        run.id,
        dependencies.workerId,
        leaseMs,
      );
      if (!status.owned) {
        ownershipLost = true;
        controller.abort(new KgOwnershipLostError());
        return false;
      }
      if (status.cancelRequested) {
        cancellationObserved = true;
        controller.abort(new KgCancellationRequestedError());
        await cancelOwnedRun();
        return false;
      }
      return true;
    })()
      .catch((error) => {
        ownershipLost = true;
        controller.abort(error);
        dependencies.logger.error(
          context('heartbeat_error'),
          'KG worker heartbeat failed',
        );
        return false;
      })
      .finally(() => {
        heartbeatPromise = null;
      });
    return heartbeatPromise;
  };

  if (cancellationObserved) {
    if (await cancelOwnedRun()) {
      result.cancelled += 1;
      dependencies.logger.info(
        context('cancelled', {
          outcome: 'cancelled',
          stageDurationMs: stageDurationMs(),
        }),
        'KG run cancelled before execution',
      );
    } else {
      result.superseded += 1;
    }
    return;
  }

  if (!(await maintainOwnership())) {
    if (cancellationObserved) result.cancelled += 1;
    else result.superseded += 1;
    return;
  }

  heartbeatHandle = timers.setInterval(() => {
    void maintainOwnership();
  }, heartbeatIntervalMs);
  heartbeatHandle.unref?.();

  try {
    const execution = await dependencies.execute({
      run,
      workerId: dependencies.workerId,
      signal: controller.signal,
      async heartbeat() {
        return maintainOwnership();
      },
      async advanceStage(nextStage, progress, statsPatch) {
        if (controller.signal.aborted) return false;
        const advanced = await dependencies.repository.advanceStage(
          run.id,
          dependencies.workerId,
          stage,
          nextStage,
          progress,
          statsPatch,
        );
        if (!advanced) {
          await finalizeCancellationAfterCasLoss();
          return false;
        }
        const previousStage = stage;
        const transitionedAt = now();
        stage = nextStage;
        Object.assign(run.progress, progress ?? {});
        Object.assign(run.stats, statsPatch ?? {});
        dependencies.logger.info(
          context('stage_advanced', {
            previousStage,
            nextStage,
            stageDurationMs: stageDurationMs(transitionedAt),
          }),
          'KG run stage advanced',
        );
        stageStartedAt = transitionedAt;
        return true;
      },
      async saveSnapshotAndAdvance(
        snapshot,
        nextStage,
        progress,
        statsPatch,
      ) {
        if (controller.signal.aborted) return false;
        const advanced =
          await dependencies.repository.saveSnapshotAndAdvance(
            run.id,
            dependencies.workerId,
            stage,
            snapshot,
            nextStage,
            progress,
            statsPatch,
          );
        if (!advanced) {
          await finalizeCancellationAfterCasLoss();
          return false;
        }
        const previousStage = stage;
        const transitionedAt = now();
        run.snapshot = snapshot;
        stage = nextStage;
        Object.assign(run.progress, progress ?? {});
        Object.assign(run.stats, statsPatch ?? {});
        dependencies.logger.info(
          context('snapshot_saved', {
            previousStage,
            nextStage,
            stageDurationMs: stageDurationMs(transitionedAt),
          }),
          'KG run snapshot persisted and stage advanced',
        );
        stageStartedAt = transitionedAt;
        return true;
      },
    });

    if (!(await maintainOwnership())) {
      if (cancellationObserved) result.cancelled += 1;
      else result.superseded += 1;
      return;
    }

    const finished = await dependencies.repository.finish(
      run.id,
      dependencies.workerId,
      stage,
      execution.outcome,
      execution.progress,
      execution.statsPatch,
    );
    if (!finished) {
      if (await finalizeCancellationAfterCasLoss()) {
        result.cancelled += 1;
      } else {
        result.superseded += 1;
      }
      return;
    }
    result[execution.outcome] += 1;
    dependencies.logger.info(
      context('terminal', {
        outcome: execution.outcome,
        stageDurationMs: stageDurationMs(),
      }),
      'KG run reached a terminal outcome',
    );
  } catch (error) {
    if (cancellationObserved) {
      result.cancelled += 1;
      return;
    }
    if (ownershipLost) {
      result.superseded += 1;
      return;
    }
    if (!(await maintainOwnership())) {
      if (cancellationObserved) result.cancelled += 1;
      else result.superseded += 1;
      return;
    }

    const { failure, retryable } = getFailure(error);
    const attemptLimit = Math.min(
      MAX_CLAIMED_ATTEMPTS,
      positiveInteger(run.maxAttempts, MAX_CLAIMED_ATTEMPTS),
    );
    if (retryable && run.attemptCount < attemptLimit) {
      const delayMs = retryDelayMs(
        run.attemptCount,
        dependencies.random ?? Math.random,
        positiveInteger(dependencies.retryBaseMs, DEFAULT_RETRY_BASE_MS),
        positiveInteger(dependencies.retryMaxMs, DEFAULT_RETRY_MAX_MS),
      );
      if (
        await dependencies.repository.retry(
          run.id,
          dependencies.workerId,
          stage,
          failure,
          delayMs,
        )
      ) {
        result.retried += 1;
        dependencies.logger.warn(
          context('retry', {
            outcome: 'queued',
            errorCode: failure.code,
            retryDelayMs: delayMs,
            stageDurationMs: stageDurationMs(),
          }),
          'KG run scheduled for retry',
        );
      } else {
        if (await finalizeCancellationAfterCasLoss()) {
          result.cancelled += 1;
        } else {
          result.superseded += 1;
        }
      }
      return;
    }

    if (
      await dependencies.repository.fail(
        run.id,
        dependencies.workerId,
        stage,
        failure,
      )
    ) {
      result.failed += 1;
      dependencies.logger.error(
        context('terminal', {
          outcome: 'failed',
          errorCode: failure.code,
          stageDurationMs: stageDurationMs(),
        }),
        'KG run failed',
      );
    } else {
      if (await finalizeCancellationAfterCasLoss()) {
        result.cancelled += 1;
      } else {
        result.superseded += 1;
      }
    }
  } finally {
    if (heartbeatHandle) timers.clearInterval(heartbeatHandle);
  }
}

export async function processKgWorkerBatch(
  dependencies: KgWorkerDependencies,
): Promise<KgWorkerBatchResult> {
  const result = emptyBatchResult();
  const recovered = await dependencies.repository.recoverAbandoned();
  result.cancelled += recovered.cancelled;
  result.failed += recovered.failed;
  try {
    const queue = await dependencies.repository.loadQueueTelemetry();
    dependencies.logger.info(
      {
        workerId: dependencies.workerId,
        transition: 'queue_observed',
        queueDepth: queue.depth,
        oldestQueueAgeMs: queue.oldestAgeMs,
      },
      'KG worker queue observed',
    );
  } catch (error) {
    dependencies.logger.warn(
      {
        workerId: dependencies.workerId,
        transition: 'queue_observation_failed',
        errorCode: deterministicFailure(error).code,
      },
      'KG worker queue telemetry failed',
    );
  }
  const batchSize = positiveInteger(
    dependencies.batchSize,
    DEFAULT_BATCH_SIZE,
  );
  const leaseMs = positiveInteger(dependencies.leaseMs, DEFAULT_LEASE_MS);
  for (let index = 0; index < batchSize; index += 1) {
    const [run] = await dependencies.repository.claimBatch(
      dependencies.workerId,
      1,
      leaseMs,
    );
    if (!run) break;
    result.claimed += 1;
    try {
      await processClaimedRun(run, dependencies, result);
    } catch (error) {
      result.superseded += 1;
      dependencies.logger.error(
        {
          runId: run.id,
          workerId: dependencies.workerId,
          attempt: run.attemptCount,
          stage: run.stage,
          transition: 'worker_error',
          errorCode: deterministicFailure(error).code,
        },
        'KG worker could not persist a run transition',
      );
    }
  }
  return result;
}

function defaultYieldControl(): Promise<void> {
  return new Promise((resolve) => {
    const handle = setImmediate(resolve);
    handle.unref?.();
  });
}

async function logWorkerLoopError(error: unknown): Promise<void> {
  const { logger } = await import('../../shared/logger');
  logger.error(
    {
      module: 'kg-worker',
      transition: 'batch_error',
      errorCode: deterministicFailure(error).code,
    },
    'KG worker batch failed',
  );
}

export function createKgWorker(
  options: KgWorkerOptions = {},
): KgWorkerController {
  const pollIntervalMs = positiveInteger(
    options.pollIntervalMs,
    DEFAULT_POLL_INTERVAL_MS,
  );
  const timers = options.timers ?? defaultTimers();
  const runBatch =
    options.processBatch ??
    (() =>
      options.dependencies
        ? processKgWorkerBatch(options.dependencies)
        : getDefaultDependencies().then(processKgWorkerBatch));
  const onError = options.onError ?? logWorkerLoopError;
  const yieldControl = options.yieldControl ?? defaultYieldControl;

  let stopped = false;
  let requested = false;
  let timer: TimerHandle | null = null;
  let drainPromise: Promise<void> | null = null;

  const clearPollTimer = () => {
    if (!timer) return;
    timers.clearTimeout(timer);
    timer = null;
  };

  const schedulePoll = () => {
    if (stopped || timer) return;
    timer = timers.setTimeout(() => {
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
          const batch = await runBatch();
          if (batch.claimed > 0 && !stopped) {
            requested = true;
            await yieldControl();
          }
        } catch (error) {
          try {
            await onError(error);
          } catch {
            // Detached logging must not create an unhandled rejection.
          }
        }
      }
    } finally {
      drainPromise = null;
      if (!stopped && requested) launch();
      else schedulePoll();
    }
  };

  const launch = () => {
    if (stopped || drainPromise) return;
    drainPromise = drain();
  };

  const controller: KgWorkerController = {
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

async function createDefaultDependencies(): Promise<KgWorkerDependencies> {
  const [{ db }, { logger }, { createKnowledgeGraphExecutor }] =
    await Promise.all([
      import('../../db'),
      import('../../shared/logger'),
      import('./kg-run-executor'),
    ]);
  const workerId = randomUUID();
  return {
    workerId,
    repository: createPostgresKgRunRepository(db),
    execute: createKnowledgeGraphExecutor(),
    logger: logger.child({ module: 'kg-worker', workerId }),
    batchSize: DEFAULT_BATCH_SIZE,
    leaseMs: DEFAULT_LEASE_MS,
    heartbeatIntervalMs: Math.floor(DEFAULT_LEASE_MS / 3),
    retryBaseMs: DEFAULT_RETRY_BASE_MS,
    retryMaxMs: DEFAULT_RETRY_MAX_MS,
  };
}

function getDefaultDependencies(): Promise<KgWorkerDependencies> {
  defaultDependenciesPromise ??= createDefaultDependencies();
  return defaultDependenciesPromise;
}

export function startKgWorker(
  options: KgWorkerOptions = {},
): KgWorkerController {
  if (activeWorker) return activeWorker;
  const worker = createKgWorker(options);
  const originalStop = worker.stop;
  const controller: KgWorkerController = {
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

export function requestKgWorker(): void {
  activeWorker?.request();
}

export function startKgWorkerIfEnabled(options: {
  enabled: boolean;
  isTest: boolean;
  start: () => KgWorkerController;
}): KgWorkerController | null {
  if (!options.enabled || options.isTest) return null;
  return options.start();
}
