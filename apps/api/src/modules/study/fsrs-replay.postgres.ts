import type postgres from 'postgres';
import type { ReservedSql, TransactionSql } from 'postgres';
import { ConflictError, ValidationError } from '../../shared/errors';
import {
  canonicalJson,
  fsrsReplayPersistedEventPayload,
  type FsrsReplayCardState,
  type FsrsReplayManifest,
  type FsrsReplayParameterRevision,
  type FsrsReplayScope,
  type FsrsReplaySnapshot,
} from './fsrs-replay-planner';
import type {
  FsrsReplayApplyRepositoryInput,
  FsrsReplayRepository,
} from './fsrs-replay.service';
import {
  FSRS_ALGORITHM_VERSION,
  FSRS_LIBRARY_VERSION,
  FSRS_POLICY_VERSION,
} from './fsrs.engine';

type Sql = ReturnType<typeof postgres>;
type Queryable = Pick<TransactionSql, 'unsafe'>;

const ADVISORY_LOCK_ID = '73918427409133721';
const LOCK_TIMEOUT = '5s';
const STATEMENT_TIMEOUT = '5min';

export function createPostgresFsrsReplayRepository(
  sql: Sql,
  databaseTarget: string,
): FsrsReplayRepository {
  return {
    databaseTarget,
    async readDryRunSnapshot(scope) {
      return sql.begin(
        'ISOLATION LEVEL REPEATABLE READ READ ONLY',
        (transaction) => loadSnapshot(transaction, scope),
      );
    },
    async apply(input) {
      return applyWithLock(sql, input);
    },
  };
}

async function applyWithLock(
  pool: Sql,
  input: FsrsReplayApplyRepositoryInput,
) {
  const reserved = await pool.reserve();
  let ownsLock = false;
  let runId: string | undefined;
  try {
    const [lock] = await reserved.unsafe<
      Array<{ acquired: boolean }>
    >(
      'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
      [ADVISORY_LOCK_ID],
    );
    ownsLock = Boolean(lock?.acquired);
    if (!ownsLock) {
      throw new ConflictError('Another FSRS replay is already running');
    }

    const recoveredRuns = await recoverAbandonedRuns(reserved);
    const prior = await findCompletedRun(
      reserved,
      input.expectedSourceChecksum,
      input.expectedResultChecksum,
    );

    if (prior) {
      const manifest = await withReservedTransaction(
        reserved,
        'ISOLATION LEVEL SERIALIZABLE READ WRITE',
        async (transaction) => {
          await configureAndLockSources(transaction);
          const plan = input.createPlan(
            await loadSnapshot(transaction, input.scope),
          );
          await requireEquivalentCanonical(transaction, input.scope, plan);
          return plan;
        },
      );
      return {
        runId: prior.id,
        reused: true,
        recoveredRuns,
        manifest,
      };
    }

    runId = crypto.randomUUID();
    await withReservedTransaction(reserved, '', async (transaction) => {
      await transaction.unsafe(
        `INSERT INTO fsrs_migration_runs (
          id, status, engine_version, algorithm_version, policy_version,
          source_counts, result_counts, anomalies, source_checksum
        ) VALUES (
          $1::uuid, 'running', $2, $3, $4, '{}'::jsonb, '{}'::jsonb,
          '[]'::jsonb, $5
        )`,
        [
          runId!,
          FSRS_LIBRARY_VERSION,
          FSRS_ALGORITHM_VERSION,
          FSRS_POLICY_VERSION,
          input.expectedSourceChecksum,
        ],
      );
    });

    const manifest = await withReservedTransaction(
      reserved,
      'ISOLATION LEVEL SERIALIZABLE READ WRITE',
      async (transaction) => {
        await configureAndLockSources(transaction);
        const plan = input.createPlan(
          await loadSnapshot(transaction, input.scope),
        );
        await requireEmptyCanonical(transaction, input.scope);
        await insertReplayPlan(transaction, plan);
        const completed = await transaction.unsafe<Array<{ id: string }>>(
          `UPDATE fsrs_migration_runs
           SET status = 'completed',
               engine_version = $2,
               algorithm_version = $3,
               policy_version = $4,
               finished_at = clock_timestamp(),
               source_counts = $5::jsonb,
               result_counts = $6::jsonb,
               anomalies = $7::jsonb,
               result_checksum = $8
           WHERE id = $1::uuid AND status = 'running'
           RETURNING id::text AS id`,
          [
            runId!,
            plan.engineVersion,
            plan.algorithmVersion,
            plan.policyVersion,
            sourceCounts(plan),
            plan.counts,
            anomalyList(plan),
            plan.resultChecksum,
          ],
        );
        if (completed.length !== 1) {
          throw new ConflictError(
            'FSRS replay audit row changed during completion',
          );
        }
        return plan;
      },
    );
    return {
      runId,
      reused: false,
      recoveredRuns,
      manifest,
    };
  } catch (error) {
    if (runId) {
      await markRunFailed(reserved, runId, sanitizeAuditError(error));
    }
    throw error;
  } finally {
    if (ownsLock) {
      await reserved.unsafe('SELECT pg_advisory_unlock($1::bigint)', [
        ADVISORY_LOCK_ID,
      ]);
    }
    reserved.release();
  }
}

async function configureAndLockSources(sql: Queryable) {
  await sql.unsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
  await sql.unsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
  await sql.unsafe(
    `LOCK TABLE users, decks, cards, review_logs, study_progress,
      fsrs_user_params, fsrs_parameter_revisions, fsrs_review_events,
      fsrs_card_states IN SHARE ROW EXCLUSIVE MODE`,
  );
}

async function withReservedTransaction<T>(
  sql: ReservedSql,
  options: string,
  operation: (transaction: Queryable) => Promise<T>,
) {
  await sql.unsafe(options ? `BEGIN ${options}` : 'BEGIN');
  try {
    const result = await operation(sql);
    await sql.unsafe('COMMIT');
    return result;
  } catch (error) {
    await sql.unsafe('ROLLBACK');
    throw error;
  }
}

async function loadSnapshot(
  sql: Queryable,
  scope: FsrsReplayScope,
): Promise<FsrsReplaySnapshot> {
  const { clause, parameters } = scopeSql(scope, 'u.id');
  const users = await sql.unsafe<Array<{ userId: string }>>(
    `SELECT u.id::text AS "userId"
     FROM users u ${clause}
     ORDER BY u.id`,
    parameters,
  );
  const parameterRows = await sql.unsafe<
    Array<{ userId: string; parameters: unknown }>
  >(
    `SELECT p.user_id::text AS "userId", p.params AS parameters
     FROM fsrs_user_params p
     JOIN users u ON u.id = p.user_id
     ${clause}
     ORDER BY p.user_id`,
    parameters,
  );
  const reviews = await sql.unsafe<
    Array<{
      logId: string;
      userId: string;
      cardId: string;
      ownerUserId: string;
      rating: 'again' | 'hard' | 'good' | 'easy';
      legacyState: 'new' | 'learning' | 'review' | 'relearning';
      sourceReviewedAt: string;
      schedulerReviewedAt: string;
    }>
  >(
    `SELECT
       rl.id::text AS "logId",
       rl.user_id::text AS "userId",
       rl.card_id::text AS "cardId",
       d.user_id::text AS "ownerUserId",
       rl.rating AS rating,
       rl.state AS "legacyState",
       to_char(
         rl.reviewed_at AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
       ) AS "sourceReviewedAt",
       to_char(
         date_trunc('milliseconds', rl.reviewed_at) AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
       ) AS "schedulerReviewedAt"
     FROM review_logs rl
     JOIN cards c ON c.id = rl.card_id
     JOIN decks d ON d.id = c.deck_id
     JOIN users u ON u.id = rl.user_id
     ${clause}
     ORDER BY rl.reviewed_at, rl.id`,
    parameters,
  );
  const progress = await sql.unsafe<
    Array<{ userId: string; cardId: string; ownerUserId: string }>
  >(
    `SELECT
       sp.user_id::text AS "userId",
       sp.card_id::text AS "cardId",
       d.user_id::text AS "ownerUserId"
     FROM study_progress sp
     JOIN cards c ON c.id = sp.card_id
     JOIN decks d ON d.id = c.deck_id
     JOIN users u ON u.id = sp.user_id
     ${clause}
     ORDER BY sp.user_id, sp.card_id`,
    parameters,
  );
  return {
    scope,
    scopedUserIds: users.map((row) => row.userId),
    legacyParameterRows: [...parameterRows],
    reviews: [...reviews],
    progress: [...progress],
  };
}

function scopeSql(scope: FsrsReplayScope, column: string) {
  if (scope.kind === 'all_users') {
    return { clause: '', parameters: [] as any[] };
  }
  return {
    clause: `WHERE ${column} = $1::uuid`,
    parameters: [scope.userId] as any[],
  };
}

async function recoverAbandonedRuns(sql: Queryable) {
  const rows = await sql.unsafe<Array<{ id: string }>>(
    `UPDATE fsrs_migration_runs
     SET status = 'failed',
         finished_at = clock_timestamp(),
         result_checksum = NULL,
         error_message = 'Abandoned replay recovered under advisory lock'
     WHERE status = 'running'
     RETURNING id::text AS id`,
  );
  return rows.length;
}

async function findCompletedRun(
  sql: Queryable,
  sourceChecksum: string,
  resultChecksum: string,
) {
  const [run] = await sql.unsafe<Array<{ id: string }>>(
    `SELECT id::text AS id
     FROM fsrs_migration_runs
     WHERE status = 'completed'
       AND source_checksum = $1
       AND result_checksum = $2
     ORDER BY finished_at, id
     LIMIT 1`,
    [sourceChecksum, resultChecksum],
  );
  return run;
}

async function markRunFailed(
  sql: ReservedSql,
  runId: string,
  message: string,
) {
  await withReservedTransaction(sql, '', async (transaction) => {
    await transaction.unsafe(
      `UPDATE fsrs_migration_runs
       SET status = 'failed',
           finished_at = clock_timestamp(),
           result_checksum = NULL,
           error_message = $2
       WHERE id = $1::uuid AND status = 'running'`,
      [runId, message],
    );
  });
}

function sanitizeAuditError(error: unknown) {
  if (error instanceof ConflictError) {
    return 'FSRS replay failed: canonical conflict';
  }
  if (error instanceof ValidationError) {
    return 'FSRS replay failed: validation or checksum mismatch';
  }
  return 'FSRS replay failed: persistence transaction rolled back';
}

async function requireEmptyCanonical(
  sql: Queryable,
  scope: FsrsReplayScope,
) {
  const existing = await canonicalCounts(sql, scope);
  if (existing.revisions || existing.events || existing.states) {
    throw new ConflictError(
      'Canonical FSRS data already exists for the replay scope',
    );
  }
}

async function requireEquivalentCanonical(
  sql: Queryable,
  scope: FsrsReplayScope,
  plan: FsrsReplayManifest,
) {
  const actual = await readCanonical(sql, scope);
  const expected = {
    parameterRevisions: plan.parameterRevisions,
    events: plan.events.map(fsrsReplayPersistedEventPayload),
    cardStates: plan.cardStates,
  };
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new ConflictError(
      'Canonical FSRS data differs from the approved replay',
    );
  }
}

async function canonicalCounts(sql: Queryable, scope: FsrsReplayScope) {
  const { clause, parameters } = scopeSql(scope, 'user_id');
  const suffix = clause.replace(/^WHERE/u, 'WHERE');
  const [row] = await sql.unsafe<
    Array<{ revisions: number; events: number; states: number }>
  >(
    `SELECT
       (SELECT count(*)::int FROM fsrs_parameter_revisions ${suffix}) AS revisions,
       (SELECT count(*)::int FROM fsrs_review_events ${suffix}) AS events,
       (SELECT count(*)::int FROM fsrs_card_states ${suffix}) AS states`,
    parameters,
  );
  return row ?? { revisions: 0, events: 0, states: 0 };
}

async function readCanonical(sql: Queryable, scope: FsrsReplayScope) {
  const { clause, parameters } = scopeSql(scope, 'user_id');
  const revisions = await sql.unsafe<FsrsReplayParameterRevision[]>(
    `SELECT id::text AS id, user_id::text AS "userId", revision,
       engine_version AS "engineVersion",
       algorithm_version AS "algorithmVersion",
       policy_version AS "policyVersion", parameters,
       params_hash AS "paramsHash", source
     FROM fsrs_parameter_revisions ${clause}
     ORDER BY user_id, revision`,
    parameters,
  );
  const events = await sql.unsafe<
    Array<ReturnType<typeof fsrsReplayPersistedEventPayload>>
  >(
    `SELECT id::text AS id, request_id::text AS "requestId",
       user_id::text AS "userId", card_id::text AS "cardId",
       learning_cycle AS "learningCycle", sequence, rating,
       to_char(reviewed_at AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "reviewedAt",
       duration_ms AS "durationMs",
       parameter_revision_id::text AS "parameterRevisionId", origin,
       before_state AS "beforeState",
       CASE WHEN before_due_at IS NULL THEN NULL ELSE
         to_char(before_due_at AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS "beforeDueAt",
       before_stability AS "beforeStability",
       before_difficulty AS "beforeDifficulty",
       before_scheduled_days AS "beforeScheduledDays",
       before_learning_steps AS "beforeLearningSteps",
       elapsed_days AS "elapsedDays", after_state AS "afterState",
       to_char(after_due_at AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "afterDueAt",
       after_stability AS "afterStability",
       after_difficulty AS "afterDifficulty",
       after_scheduled_days AS "afterScheduledDays",
       after_learning_steps AS "afterLearningSteps",
       after_reps AS "afterReps", after_lapses AS "afterLapses",
       after_state_version::int AS "afterStateVersion"
     FROM fsrs_review_events ${clause}
     ORDER BY user_id, card_id, learning_cycle, sequence`,
    parameters,
  );
  const states = await sql.unsafe<FsrsReplayCardState[]>(
    `SELECT user_id::text AS "userId", card_id::text AS "cardId",
       to_char(next_review_at AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "nextReviewAt",
       to_char(last_reviewed_at AT TIME ZONE 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastReviewedAt",
       stability, difficulty, state, elapsed_days AS "elapsedDays",
       scheduled_days AS "scheduledDays",
       learning_steps AS "learningSteps", reps, lapses,
       parameter_revision_id::text AS "parameterRevisionId",
       state_version::int AS "stateVersion",
       learning_cycle AS "learningCycle"
     FROM fsrs_card_states ${clause}
     ORDER BY user_id, card_id`,
    parameters,
  );
  return {
    parameterRevisions: [...revisions],
    events: [...events],
    cardStates: [...states],
  };
}

async function insertReplayPlan(sql: Queryable, plan: FsrsReplayManifest) {
  await insertRows(
    sql,
    'fsrs_parameter_revisions',
    [
      'id',
      'user_id',
      'revision',
      'engine_version',
      'algorithm_version',
      'policy_version',
      'parameters',
      'params_hash',
      'source',
    ],
    ['::uuid', '::uuid', '', '', '', '', '::jsonb', '', ''],
    plan.parameterRevisions.map((revision) => [
        revision.id,
        revision.userId,
        revision.revision,
        revision.engineVersion,
        revision.algorithmVersion,
        revision.policyVersion,
        revision.parameters as any,
        revision.paramsHash,
        revision.source,
      ]),
  );
  await insertRows(
    sql,
    'fsrs_review_events',
    [
      'id',
      'request_id',
      'user_id',
      'card_id',
      'learning_cycle',
      'sequence',
      'rating',
      'reviewed_at',
      'duration_ms',
      'parameter_revision_id',
      'origin',
      'before_state',
      'before_due_at',
      'before_stability',
      'before_difficulty',
      'before_scheduled_days',
      'before_learning_steps',
      'elapsed_days',
      'after_state',
      'after_due_at',
      'after_stability',
      'after_difficulty',
      'after_scheduled_days',
      'after_learning_steps',
      'after_reps',
      'after_lapses',
      'after_state_version',
    ],
    [
      '::uuid', '::uuid', '::uuid', '::uuid', '', '', '', '::timestamptz',
      '', '::uuid', '', '', '::timestamptz', '', '', '', '', '', '',
      '::timestamptz', '', '', '', '', '', '', '',
    ],
    plan.events.map((source) => {
      const event = fsrsReplayPersistedEventPayload(source);
      return [
        event.id,
        event.requestId,
        event.userId,
        event.cardId,
        event.learningCycle,
        event.sequence,
        event.rating,
        event.reviewedAt,
        event.durationMs,
        event.parameterRevisionId,
        event.origin,
        event.beforeState,
        event.beforeDueAt,
        event.beforeStability,
        event.beforeDifficulty,
        event.beforeScheduledDays,
        event.beforeLearningSteps,
        event.elapsedDays,
        event.afterState,
        event.afterDueAt,
        event.afterStability,
        event.afterDifficulty,
        event.afterScheduledDays,
        event.afterLearningSteps,
        event.afterReps,
        event.afterLapses,
        event.afterStateVersion,
      ];
    }),
  );
  await insertRows(
    sql,
    'fsrs_card_states',
    [
      'user_id',
      'card_id',
      'next_review_at',
      'last_reviewed_at',
      'stability',
      'difficulty',
      'state',
      'elapsed_days',
      'scheduled_days',
      'learning_steps',
      'reps',
      'lapses',
      'parameter_revision_id',
      'state_version',
      'learning_cycle',
    ],
    [
      '::uuid', '::uuid', '::timestamptz', '::timestamptz', '', '', '',
      '', '', '', '', '', '::uuid', '', '',
    ],
    plan.cardStates.map((state) => [
        state.userId,
        state.cardId,
        state.nextReviewAt,
        state.lastReviewedAt,
        state.stability,
        state.difficulty,
        state.state,
        state.elapsedDays,
        state.scheduledDays,
        state.learningSteps,
        state.reps,
        state.lapses,
        state.parameterRevisionId,
        state.stateVersion,
        state.learningCycle,
      ]),
  );
}

async function insertRows(
  sql: Queryable,
  table: string,
  columns: readonly string[],
  casts: readonly string[],
  rows: readonly (readonly unknown[])[],
) {
  if (rows.length === 0) return;
  if (columns.length !== casts.length) {
    throw new Error('Invalid replay bulk insert definition');
  }
  const chunkSize = Math.max(1, Math.floor(20_000 / columns.length));
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const parameters: any[] = [];
    const values = chunk.map((row) => {
      if (row.length !== columns.length) {
        throw new Error('Invalid replay bulk insert row');
      }
      const placeholders = row.map((value, index) => {
        parameters.push(value);
        return `$${parameters.length}${casts[index]}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await sql.unsafe(
      `INSERT INTO ${table} (${columns.join(', ')})
       VALUES ${values.join(', ')}`,
      parameters,
    );
  }
}

function sourceCounts(plan: FsrsReplayManifest) {
  return {
    users: plan.counts.users,
    reviews: plan.counts.reviews,
    progressRows: plan.counts.progressRows,
  };
}

function anomalyList(plan: FsrsReplayManifest) {
  return [
    {
      type: 'progress_without_history',
      count: plan.counts.progressWithoutHistory,
      items: plan.anomalies.progressWithoutHistory,
    },
    {
      type: 'same_timestamp_reviews',
      count: plan.counts.sameTimestampReviewGroups,
      items: plan.anomalies.sameTimestampReviews,
    },
    {
      type: 'inferred_resets',
      count: plan.counts.inferredResets,
      items: plan.anomalies.inferredResets,
    },
    {
      type: 'truncated_histories',
      count: plan.counts.truncatedHistories,
      items: plan.anomalies.truncatedHistories,
    },
  ];
}
