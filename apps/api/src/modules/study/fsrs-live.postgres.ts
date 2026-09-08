import type postgres from 'postgres';
import type { TransactionSql } from 'postgres';
import { State, type Card } from 'ts-fsrs';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors';
import {
  bindJson,
  bindTimestamp,
  timestampFromRow,
  type PgTimestamp,
} from '../../db/pg-codecs';
import {
  assertMatchingLiveReviewRequest,
  assertReviewChronology,
  canonicalUuid,
  deriveNextReviewPosition,
  groupReviewsByStudyDate,
  reviewResultFromEvent,
  sortedUniqueCardIds,
  type LiveReviewEventSnapshot,
  type NormalizedLiveReviewCommand,
  type PersistedFsrsState,
  type ReviewEventResult,
} from './fsrs-live.domain';
import {
  sha256Canonical,
} from './fsrs-canonical';
import {
  canonicalDefaultFsrsParameters as canonicalDefaultParameters,
  canonicalFsrsParameters as canonicalParameters,
  deterministicFsrsParameterRevisionId as deterministicRevisionId,
  validateFsrsParameterRevisionIdentity as validateRevisionIdentity,
} from './fsrs-revision';
import type {
  FsrsLiveRepository,
  FsrsLiveReviewBatchRepositoryInput,
  FsrsLiveReviewBatchResult,
} from './fsrs-live.service';
import {
  FSRS_ALGORITHM_VERSION,
  FSRS_LIBRARY_VERSION,
  FSRS_POLICY_VERSION,
  scheduleFsrsReview,
} from './fsrs.engine';

type Sql = ReturnType<typeof postgres>;
type Queryable = Pick<TransactionSql, 'unsafe'>;
type Scheduler = typeof scheduleFsrsReview;

const MAX_TRANSACTION_ATTEMPTS = 5;
const RETRYABLE_TRANSACTION_CODES = new Set(['40001', '40P01']);
const REQUEST_UNIQUE_CONSTRAINT =
  'uq_fsrs_review_events_user_request';
const DEFAULT_REVISION_UNIQUE_CONSTRAINTS = new Set([
  'uq_fsrs_parameter_revisions_active_user',
  'uq_fsrs_parameter_revisions_resolved_params',
  'uq_fsrs_parameter_revisions_user_revision',
  'fsrs_parameter_revisions_pkey',
]);

interface LockedCard {
  id: string;
  deckId: string;
}

interface LockedDeck {
  id: string;
  userId: string;
}

interface PersistedStateRow {
  cardId: string;
  nextReviewAt: Date;
  lastReviewedAt: Date;
  stability: number;
  difficulty: number;
  state: PersistedFsrsState;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  parameterRevisionId: string;
  stateVersion: string;
  learningCycle: number;
}

interface ParameterRevisionRow {
  id: string;
  revision: number;
  parameters: unknown;
  engineVersion: string;
  algorithmVersion: string;
  policyVersion: string;
  paramsHash: string;
  source: string;
  /** Only ever compared against `null`; may be postgres text via pgClient. */
  retiredAt: PgTimestamp | null;
}

interface DefaultRevision {
  id: string;
  revision: number;
  parameters: Record<string, unknown>;
  engineVersion: string;
  algorithmVersion: string;
  policyVersion: string;
  paramsHash: string;
  source: 'default';
  retiredAt: null;
}

export interface FsrsLivePostgresHooks {
  afterUserLocked?(context: {
    userId: string;
    operation: 'review' | 'reset' | 'rotation';
  }): void | Promise<void>;
  afterCardsAndDecksLocked?(context: {
    userId: string;
    cardIds: readonly string[];
    deckIds: readonly string[];
    operation: 'review' | 'reset';
  }): void | Promise<void>;
  afterEventAndStateWrittenBeforeDailyLog?(context: {
    userId: string;
    appliedCommands: readonly NormalizedLiveReviewCommand[];
  }): void | Promise<void>;
  beforeResetStateDelete?(context: {
    userId: string;
    cardIds: readonly string[];
  }): void | Promise<void>;
  afterDeckResetCandidatesRead?(context: {
    userId: string;
    deckId: string;
    cardIds: readonly string[];
  }): void | Promise<void>;
  afterUniqueRaceRollback?(context: {
    userId: string;
    kind: UniqueRaceClassification['kind'];
    constraintName: string;
  }): void | Promise<void>;
}

export interface FsrsLivePostgresOptions {
  schedule?: Scheduler;
  hooks?: FsrsLivePostgresHooks;
}

interface UniqueRaceClassification {
  kind: 'request' | 'default';
  constraintName: string;
  originalError: unknown;
}

export function createPostgresFsrsLiveRepository(
  pool: Sql,
  options: FsrsLivePostgresOptions = {},
): FsrsLiveRepository {
  const scheduler = options.schedule ?? scheduleFsrsReview;
  const hooks = options.hooks ?? {};

  return {
    async applyReviewBatch(input) {
      try {
        return await retrySerializable(() =>
          pool.begin('isolation level serializable', (transaction) =>
            applyReviewBatchTransaction(
              transaction,
              input,
              scheduler,
              hooks,
            ),
          ),
        );
      } catch (error) {
        const classification = uniqueRaceClassification(error);
        if (!classification) throw error;
        await hooks.afterUniqueRaceRollback?.({
          userId: input.userId,
          kind: classification.kind,
          constraintName: classification.constraintName,
        });
        return retrySerializable(() =>
          pool.begin('isolation level serializable', (transaction) =>
            applyReviewBatchTransaction(
              transaction,
              input,
              scheduler,
              hooks,
              classification,
            ),
          ),
        );
      }
    },
    resetCards(userId, cardIds) {
      const sortedCardIds = sortedUniqueText(cardIds);
      return retrySerializable(() =>
        pool.begin('isolation level serializable', (transaction) =>
          resetCardsTransaction(
            transaction,
            userId,
            sortedCardIds,
            hooks,
          ),
        ),
      );
    },
    resetDeck(userId, deckId) {
      return retrySerializable(() =>
        pool.begin('isolation level serializable', (transaction) =>
          resetDeckTransaction(transaction, userId, deckId, hooks),
        ),
      );
    },
    rotateParameters(userId, parameters) {
      const canonicalUserId = canonicalUuid(userId, 'User id');
      return retrySerializable(() =>
        pool.begin('isolation level serializable', (transaction) =>
          rotateParametersTransaction(
            transaction,
            canonicalUserId,
            parameters,
            hooks,
          ),
        ),
      );
    },
  };
}

async function applyReviewBatchTransaction(
  sql: Queryable,
  input: FsrsLiveReviewBatchRepositoryInput,
  scheduler: Scheduler,
  hooks: FsrsLivePostgresHooks,
  race?: UniqueRaceClassification,
): Promise<FsrsLiveReviewBatchResult> {
  await lockUser(sql, input.userId);
  await hooks.afterUserLocked?.({
    userId: input.userId,
    operation: 'review',
  });

  const cardIds = sortedUniqueCardIds(input.commands);
  const cards = await lockCards(sql, cardIds);
  const deckIds = sortedUniqueText(cards.map((card) => card.deckId));
  const decks = await lockDecks(sql, deckIds);
  await requireOwnedCardsAfterLocks(
    sql,
    input.userId,
    cardIds,
    cards,
    decks,
  );
  await hooks.afterCardsAndDecksLocked?.({
    userId: input.userId,
    cardIds,
    deckIds,
    operation: 'review',
  });

  const existingEvents = await lockRequestEvents(
    sql,
    input.userId,
    input.commands.map((command) => command.requestId),
  );
  const existingByRequestId = new Map(
    existingEvents.map((event) => [event.requestId, event]),
  );
  const states = await lockStates(sql, input.userId, cardIds);
  const stateByCardId = new Map(
    states.map((state) => [
      state.cardId,
      persistedStateFromRow(state),
    ]),
  );
  const maximumCycles = await loadMaximumLearningCycles(
    sql,
    input.userId,
    cardIds,
  );
  const revisions = await lockParameterRevisions(sql, input.userId);
  classifyUniqueRaceAfterLocks(
    input.userId,
    existingEvents,
    revisions,
    input.commands,
    race,
  );
  const revisionById = new Map(
    revisions.map((revision) => [revision.id, revision]),
  );
  const validatedParametersByRevisionId = new Map<
    string,
    Record<string, unknown>
  >();
  const newCommands = input.commands.filter(
    (command) => !existingByRequestId.has(command.requestId),
  );
  const cardsWithNewCommands = new Set(
    newCommands.map((command) => command.cardId),
  );

  for (const state of states) {
    if (!cardsWithNewCommands.has(state.cardId)) continue;
    const revision = revisionById.get(state.parameterRevisionId);
    if (!revision) {
      throw new ValidationError(
        'FSRS card state references a missing parameter revision',
      );
    }
    validatedParametersByRevisionId.set(
      revision.id,
      validateRevisionIdentity(input.userId, revision),
    );
  }

  const needsActiveRevision = newCommands.some(
    (command) =>
      !stateByCardId.has(command.cardId),
  );
  let activeRevision = revisions.find(
    (revision) => revision.retiredAt === null,
  );
  if (needsActiveRevision && !activeRevision) {
    activeRevision = await createOrReactivateDefaultRevision(
      sql,
      input.userId,
      revisions,
    );
    revisions.push(activeRevision);
    revisionById.set(activeRevision.id, activeRevision);
  }
  if (needsActiveRevision && !activeRevision) {
    throw new ValidationError('No active FSRS parameter revision');
  }
  if (needsActiveRevision && activeRevision) {
    validatedParametersByRevisionId.set(
      activeRevision.id,
      validateRevisionIdentity(input.userId, activeRevision),
    );
  }

  const results: ReviewEventResult[] = [];
  const appliedCommands: NormalizedLiveReviewCommand[] = [];
  for (const command of input.commands) {
    const duplicate = existingByRequestId.get(command.requestId);
    if (duplicate) {
      assertMatchingLiveReviewRequest(command, duplicate);
      results.push(reviewResultFromEvent(duplicate, 'duplicate'));
      continue;
    }

    const current = stateByCardId.get(command.cardId) ?? null;
    if (current) {
      assertReviewChronology(command.reviewedAt, current.lastReviewedAt);
    }
    const position = deriveNextReviewPosition(
      current
        ? {
            state: {
              learningCycle: current.learningCycle,
              stateVersion: current.stateVersion,
            },
          }
        : {
            state: null,
            maxPriorLearningCycle:
              maximumCycles.get(command.cardId) ?? null,
          },
    );
    const revision = current
      ? revisionById.get(current.parameterRevisionId)
      : activeRevision;
    if (!revision) {
      throw new ValidationError('Missing FSRS parameter revision');
    }
    const parameters =
      validatedParametersByRevisionId.get(revision.id) ??
      validateRevisionIdentity(input.userId, revision);
    validatedParametersByRevisionId.set(revision.id, parameters);
    const reviewedAt = new Date(command.reviewedAt);
    const scheduled = scheduler({
      current: current ? cardFromState(current) : null,
      rating: command.rating,
      reviewedAt,
      parameters,
    });
    validateScheduledProjection(scheduled.after, position.sequence, reviewedAt);
    if (scheduled.log.elapsed_days !== scheduled.after.elapsed_days) {
      throw new ValidationError(
        'FSRS scheduler returned inconsistent elapsed days',
      );
    }

    const event = eventFromSchedule(
      command,
      current,
      scheduled.after,
      scheduled.log.elapsed_days,
      revision.id,
      position.learningCycle,
      position.sequence,
    );
    await insertEvent(sql, input.userId, event);
    await upsertState(
      sql,
      input.userId,
      command.cardId,
      scheduled.after,
      revision.id,
      position.learningCycle,
      position.sequence,
      command.receivedAt,
    );
    stateByCardId.set(
      command.cardId,
      stateFromScheduledCard(
        command.cardId,
        scheduled.after,
        revision.id,
        position.learningCycle,
        position.sequence,
      ),
    );
    maximumCycles.set(command.cardId, position.learningCycle);
    appliedCommands.push(command);
    results.push(reviewResultFromEvent(event, 'applied'));
  }

  if (appliedCommands.length > 0) {
    await hooks.afterEventAndStateWrittenBeforeDailyLog?.({
      userId: input.userId,
      appliedCommands,
    });
    const dailyCounts = groupReviewsByStudyDate(
      appliedCommands,
      input.timezoneOffsetMinutes,
    );
    for (const count of dailyCounts) {
      await sql.unsafe(
        `INSERT INTO study_daily_logs (
          user_id, study_date, cards_reviewed
        ) VALUES ($1::uuid, $2::date, $3::int)
        ON CONFLICT (user_id, study_date)
        DO UPDATE SET cards_reviewed =
          study_daily_logs.cards_reviewed + EXCLUDED.cards_reviewed`,
        [input.userId, count.studyDate, count.cardsReviewed],
      );
    }
  }

  return {
    results,
    applied: appliedCommands.length,
    duplicates: results.length - appliedCommands.length,
  };
}

async function resetCardsTransaction(
  sql: Queryable,
  userId: string,
  cardIds: readonly string[],
  hooks: FsrsLivePostgresHooks,
): Promise<number> {
  await lockUser(sql, userId);
  await hooks.afterUserLocked?.({ userId, operation: 'reset' });
  const cards = await lockCards(sql, cardIds);
  const deckIds = sortedUniqueText(cards.map((card) => card.deckId));
  const decks = await lockDecks(sql, deckIds);
  await requireOwnedCardsAfterLocks(sql, userId, cardIds, cards, decks);
  await hooks.afterCardsAndDecksLocked?.({
    userId,
    cardIds,
    deckIds,
    operation: 'reset',
  });
  await lockResetDependencies(sql, userId, cardIds);
  await hooks.beforeResetStateDelete?.({ userId, cardIds });
  const deleted = await sql.unsafe<Array<{ cardId: string }>>(
    `DELETE FROM fsrs_card_states
     WHERE user_id = $1::uuid AND card_id = ANY($2::uuid[])
     RETURNING card_id::text AS "cardId"`,
    [userId, cardIds],
  );
  return deleted.length;
}

async function rotateParametersTransaction(
  sql: Queryable,
  userId: string,
  input: unknown,
  hooks: FsrsLivePostgresHooks,
) {
  const canonicalUserId = canonicalUuid(userId, 'User id');
  await lockUser(sql, canonicalUserId);
  await hooks.afterUserLocked?.({
    userId: canonicalUserId,
    operation: 'rotation',
  });

  // Rotation never rewrites card states, so it has no affected card/deck lock
  // targets. The user lock serializes it with review/reset before revisions.
  const revisions = await lockParameterRevisions(sql, canonicalUserId);
  for (const revision of revisions) {
    validateRevisionIdentity(canonicalUserId, revision);
  }
  const parameters = canonicalParameters(input);
  const paramsHash = sha256Canonical(parameters);
  const matching = revisions.find(
    (revision) =>
      revision.engineVersion === FSRS_LIBRARY_VERSION &&
      revision.algorithmVersion === FSRS_ALGORITHM_VERSION &&
      revision.policyVersion === FSRS_POLICY_VERSION &&
      revision.paramsHash === paramsHash,
  );
  const active = revisions.find((revision) => revision.retiredAt === null);

  if (matching?.retiredAt === null) {
    return revisionResult(matching, 'active');
  }

  if (active) {
    await sql.unsafe(
      `UPDATE fsrs_parameter_revisions
       SET retired_at = clock_timestamp()
       WHERE id = $1::uuid AND retired_at IS NULL`,
      [active.id],
    );
  }

  if (matching) {
    const [reactivated] = await sql.unsafe<ParameterRevisionRow[]>(
      `UPDATE fsrs_parameter_revisions
       SET activated_at = clock_timestamp(), retired_at = NULL
       WHERE id = $1::uuid AND retired_at IS NOT NULL
       RETURNING
         id::text AS id,
         revision,
         parameters,
         engine_version AS "engineVersion",
         algorithm_version AS "algorithmVersion",
         policy_version AS "policyVersion",
         params_hash AS "paramsHash",
         source,
         retired_at AS "retiredAt"`,
      [matching.id],
    );
    if (!reactivated) {
      throw new ConflictError('FSRS parameter revision changed during rotation');
    }
    return revisionResult(reactivated, 'reactivated');
  }

  const id = deterministicRevisionId(canonicalUserId, paramsHash);
  if (revisions.some((revision) => revision.id === id)) {
    throw new ConflictError('FSRS parameter revision identity collision');
  }
  const revisionNumber =
    revisions.reduce(
      (maximum, revision) => Math.max(maximum, revision.revision),
      0,
    ) + 1;
  const [created] = await sql.unsafe<ParameterRevisionRow[]>(
    `INSERT INTO fsrs_parameter_revisions (
       id, user_id, revision, engine_version, algorithm_version,
       policy_version, parameters, params_hash, source
     ) VALUES (
       $1::uuid, $2::uuid, $3::int, $4, $5, $6, $7::text::jsonb, $8, 'manual'
     )
     RETURNING
       id::text AS id,
       revision,
       parameters,
       engine_version AS "engineVersion",
       algorithm_version AS "algorithmVersion",
       policy_version AS "policyVersion",
       params_hash AS "paramsHash",
       source,
       retired_at AS "retiredAt"`,
    [
      id,
      canonicalUserId,
      revisionNumber,
      FSRS_LIBRARY_VERSION,
      FSRS_ALGORITHM_VERSION,
      FSRS_POLICY_VERSION,
      bindJson(parameters),
      paramsHash,
    ],
  );
  if (!created) {
    throw new ConflictError('FSRS parameter revision was not created');
  }
  return revisionResult(created, 'created');
}

async function resetDeckTransaction(
  sql: Queryable,
  userId: string,
  deckId: string,
  hooks: FsrsLivePostgresHooks,
): Promise<number> {
  await lockUser(sql, userId);
  await hooks.afterUserLocked?.({ userId, operation: 'reset' });
  const candidateRows = await sql.unsafe<Array<{ id: string }>>(
    `SELECT id::text AS id
     FROM cards
     WHERE deck_id = $1::uuid
     ORDER BY id`,
    [deckId],
  );
  const cardIds = candidateRows.map((row) => row.id);
  await hooks.afterDeckResetCandidatesRead?.({
    userId,
    deckId,
    cardIds,
  });
  const cards = await lockCards(sql, cardIds);
  const decks = await lockDecks(sql, [deckId]);
  if (decks.length !== 1 || decks[0]!.userId !== userId) {
    throw new NotFoundError('Deck');
  }
  const currentRows = await sql.unsafe<Array<{ id: string }>>(
    `SELECT id::text AS id
     FROM cards
     WHERE deck_id = $1::uuid
     ORDER BY id`,
    [deckId],
  );
  const currentCardIds = currentRows.map((row) => row.id);
  if (!sameOrderedText(cardIds, currentCardIds)) {
    throw new ConflictError('Deck membership changed during reset');
  }
  if (
    cards.some((card) => card.deckId !== deckId) ||
    !sameOrderedText(
      cardIds,
      cards.map((card) => card.id),
    )
  ) {
    throw new ConflictError('Deck membership changed during reset');
  }
  await hooks.afterCardsAndDecksLocked?.({
    userId,
    cardIds,
    deckIds: [deckId],
    operation: 'reset',
  });
  await lockResetDependencies(sql, userId, cardIds);
  await hooks.beforeResetStateDelete?.({ userId, cardIds });
  const deleted = await sql.unsafe<Array<{ cardId: string }>>(
    `DELETE FROM fsrs_card_states
     WHERE user_id = $1::uuid AND card_id = ANY($2::uuid[])
     RETURNING card_id::text AS "cardId"`,
    [userId, cardIds],
  );
  return deleted.length;
}

async function lockUser(sql: Queryable, userId: string) {
  const rows = await sql.unsafe<Array<{ id: string }>>(
    `SELECT id::text AS id
     FROM users
     WHERE id = $1::uuid
     FOR UPDATE`,
    [userId],
  );
  if (rows.length !== 1) throw new NotFoundError('User');
}

async function lockCards(
  sql: Queryable,
  cardIds: readonly string[],
): Promise<LockedCard[]> {
  if (cardIds.length === 0) return [];
  return sql.unsafe<LockedCard[]>(
    `SELECT id::text AS id, deck_id::text AS "deckId"
     FROM cards
     WHERE id = ANY($1::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [cardIds],
  );
}

async function lockDecks(
  sql: Queryable,
  deckIds: readonly string[],
): Promise<LockedDeck[]> {
  if (deckIds.length === 0) return [];
  return sql.unsafe<LockedDeck[]>(
    `SELECT id::text AS id, user_id::text AS "userId"
     FROM decks
     WHERE id = ANY($1::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [deckIds],
  );
}

async function requireOwnedCardsAfterLocks(
  sql: Queryable,
  userId: string,
  cardIds: readonly string[],
  cards: readonly LockedCard[],
  decks: readonly LockedDeck[],
) {
  if (
    !sameOrderedText(
      cardIds,
      cards.map((card) => card.id),
    )
  ) {
    throw new NotFoundError('Card');
  }
  const deckIds = sortedUniqueText(cards.map((card) => card.deckId));
  if (
    !sameOrderedText(
      deckIds,
      decks.map((deck) => deck.id),
    ) ||
    decks.some((deck) => deck.userId !== userId)
  ) {
    throw new NotFoundError('Card');
  }
  const revalidated = await sql.unsafe<
    Array<{ id: string; deckId: string; userId: string }>
  >(
    `SELECT card.id::text AS id, card.deck_id::text AS "deckId",
       deck.user_id::text AS "userId"
     FROM cards card
     JOIN decks deck ON deck.id = card.deck_id
     WHERE card.id = ANY($1::uuid[])
     ORDER BY card.id`,
    [cardIds],
  );
  if (
    revalidated.length !== cardIds.length ||
    revalidated.some(
      (row, index) =>
        row.id !== cardIds[index] ||
        row.deckId !== cards[index]!.deckId ||
        row.userId !== userId,
    )
  ) {
    throw new NotFoundError('Card');
  }
}

async function lockRequestEvents(
  sql: Queryable,
  userId: string,
  requestIds: readonly string[],
): Promise<LiveReviewEventSnapshot[]> {
  const sortedRequestIds = sortedUniqueText(requestIds);
  const rows = await sql.unsafe<
    Array<
      Omit<LiveReviewEventSnapshot, 'reviewedAt' | 'afterDueAt'> & {
        reviewedAt: PgTimestamp;
        afterDueAt: PgTimestamp;
      }
    >
  >(
    `SELECT
       request_id::text AS "requestId",
       card_id::text AS "cardId",
       rating,
       reviewed_at AS "reviewedAt",
       duration_ms AS "durationMs",
       origin,
       learning_cycle AS "learningCycle",
       sequence,
       after_state AS "afterState",
       after_due_at AS "afterDueAt",
       after_stability AS "afterStability",
       after_difficulty AS "afterDifficulty",
       after_scheduled_days AS "afterScheduledDays"
     FROM fsrs_review_events
     WHERE user_id = $1::uuid
       AND request_id = ANY($2::uuid[])
     ORDER BY request_id
     FOR UPDATE`,
    [userId, sortedRequestIds],
  );
  return rows.map((row) => ({
    ...row,
    reviewedAt: timestampFromRow(row.reviewedAt, 'Persisted review reviewedAt'),
    afterDueAt: timestampFromRow(row.afterDueAt, 'Persisted review afterDueAt'),
  }));
}

async function lockStates(
  sql: Queryable,
  userId: string,
  cardIds: readonly string[],
): Promise<PersistedStateRow[]> {
  const rows = await sql.unsafe<
    Array<
      Omit<PersistedStateRow, 'nextReviewAt' | 'lastReviewedAt'> & {
        nextReviewAt: PgTimestamp;
        lastReviewedAt: PgTimestamp;
      }
    >
  >(
    `SELECT
       card_id::text AS "cardId",
       next_review_at AS "nextReviewAt",
       last_reviewed_at AS "lastReviewedAt",
       stability,
       difficulty,
       state,
       elapsed_days AS "elapsedDays",
       scheduled_days AS "scheduledDays",
       learning_steps AS "learningSteps",
       reps,
       lapses,
       parameter_revision_id::text AS "parameterRevisionId",
       state_version::text AS "stateVersion",
       learning_cycle AS "learningCycle"
     FROM fsrs_card_states
     WHERE user_id = $1::uuid
       AND card_id = ANY($2::uuid[])
     ORDER BY card_id
     FOR UPDATE`,
    [userId, cardIds],
  );
  return rows.map((row) => ({
    ...row,
    nextReviewAt: timestampFromRow(row.nextReviewAt, 'FSRS state nextReviewAt'),
    lastReviewedAt: timestampFromRow(
      row.lastReviewedAt,
      'FSRS state lastReviewedAt',
    ),
  }));
}

async function loadMaximumLearningCycles(
  sql: Queryable,
  userId: string,
  cardIds: readonly string[],
) {
  const rows = await sql.unsafe<
    Array<{ cardId: string; learningCycle: number }>
  >(
    `SELECT card_id::text AS "cardId",
       max(learning_cycle)::int AS "learningCycle"
     FROM fsrs_review_events
     WHERE user_id = $1::uuid
       AND card_id = ANY($2::uuid[])
     GROUP BY card_id
     ORDER BY card_id`,
    [userId, cardIds],
  );
  return new Map(rows.map((row) => [row.cardId, row.learningCycle]));
}

async function lockParameterRevisions(
  sql: Queryable,
  userId: string,
): Promise<ParameterRevisionRow[]> {
  return sql.unsafe<ParameterRevisionRow[]>(
    `SELECT
       id::text AS id,
       revision,
       parameters,
       engine_version AS "engineVersion",
       algorithm_version AS "algorithmVersion",
       policy_version AS "policyVersion",
       params_hash AS "paramsHash",
       source,
       retired_at AS "retiredAt"
     FROM fsrs_parameter_revisions
     WHERE user_id = $1::uuid
     ORDER BY id
     FOR UPDATE`,
    [userId],
  );
}

async function createOrReactivateDefaultRevision(
  sql: Queryable,
  userId: string,
  revisions: readonly ParameterRevisionRow[],
): Promise<DefaultRevision | ParameterRevisionRow> {
  const parameters = canonicalDefaultParameters();
  const paramsHash = sha256Canonical(parameters);
  const id = deterministicRevisionId(userId, paramsHash);
  const matching = revisions.find(
    (revision) =>
      revision.engineVersion === FSRS_LIBRARY_VERSION &&
      revision.algorithmVersion === FSRS_ALGORITHM_VERSION &&
      revision.policyVersion === FSRS_POLICY_VERSION &&
      revision.paramsHash === paramsHash,
  );
  if (matching) {
    validateRevisionIdentity(userId, matching);
    if (matching.source !== 'default' || matching.id !== id) {
      throw new ConflictError(
        'FSRS default revision identity conflicts with existing parameters',
      );
    }
    const [reactivated] = await sql.unsafe<ParameterRevisionRow[]>(
      `UPDATE fsrs_parameter_revisions
       SET retired_at = NULL, activated_at = clock_timestamp()
       WHERE id = $1::uuid
       RETURNING
         id::text AS id,
         revision,
         parameters,
         engine_version AS "engineVersion",
         algorithm_version AS "algorithmVersion",
         policy_version AS "policyVersion",
         params_hash AS "paramsHash",
         source,
         retired_at AS "retiredAt"`,
      [matching.id],
    );
    return reactivated!;
  }

  const revision =
    revisions.reduce(
      (maximum, current) => Math.max(maximum, current.revision),
      0,
    ) + 1;
  const identityCollision = revisions.find((existing) => existing.id === id);
  if (identityCollision) {
    throw new ConflictError(
      'FSRS default revision identity conflicts with existing revision',
    );
  }
  const [created] = await sql.unsafe<DefaultRevision[]>(
    `INSERT INTO fsrs_parameter_revisions (
       id, user_id, revision, engine_version, algorithm_version,
       policy_version, parameters, params_hash, source
     ) VALUES (
       $1::uuid, $2::uuid, $3::int, $4, $5, $6, $7::text::jsonb, $8, 'default'
     )
     RETURNING
       id::text AS id,
       revision,
       parameters,
       engine_version AS "engineVersion",
       algorithm_version AS "algorithmVersion",
       policy_version AS "policyVersion",
       params_hash AS "paramsHash",
       source,
       retired_at AS "retiredAt"`,
    [
      id,
      userId,
      revision,
      FSRS_LIBRARY_VERSION,
      FSRS_ALGORITHM_VERSION,
      FSRS_POLICY_VERSION,
      bindJson(parameters),
      paramsHash,
    ],
  );
  return created!;
}

function classifyUniqueRaceAfterLocks(
  userId: string,
  existingEvents: readonly LiveReviewEventSnapshot[],
  revisions: readonly ParameterRevisionRow[],
  commands: readonly NormalizedLiveReviewCommand[],
  race: UniqueRaceClassification | undefined,
) {
  if (!race) return;
  if (race.kind === 'request') {
    const commandByRequestId = new Map(
      commands.map((command) => [command.requestId, command]),
    );
    const racedEvents = existingEvents.filter((event) =>
      commandByRequestId.has(event.requestId),
    );
    if (racedEvents.length === 0) throw race.originalError;
    for (const event of racedEvents) {
      assertMatchingLiveReviewRequest(
        commandByRequestId.get(event.requestId)!,
        event,
      );
    }
    return;
  }

  const defaultParameters = canonicalDefaultParameters();
  const defaultHash = sha256Canonical(defaultParameters);
  const defaultId = deterministicRevisionId(userId, defaultHash);
  const exactDefault = revisions.find(
    (revision) =>
      revision.id === defaultId &&
      revision.source === 'default' &&
      revision.paramsHash === defaultHash,
  );
  if (!exactDefault) throw race.originalError;
  validateRevisionIdentity(userId, exactDefault);
}

function uniqueRaceClassification(
  error: unknown,
): UniqueRaceClassification | null {
  if (
    !isRecord(error) ||
    error.code !== '23505' ||
    typeof error.constraint_name !== 'string'
  ) {
    return null;
  }
  if (error.constraint_name === REQUEST_UNIQUE_CONSTRAINT) {
    return {
      kind: 'request',
      constraintName: error.constraint_name,
      originalError: error,
    };
  }
  if (DEFAULT_REVISION_UNIQUE_CONSTRAINTS.has(error.constraint_name)) {
    return {
      kind: 'default',
      constraintName: error.constraint_name,
      originalError: error,
    };
  }
  return null;
}

function revisionResult(
  revision: ParameterRevisionRow,
  status: 'active' | 'created' | 'reactivated',
) {
  return {
    id: revision.id,
    revision: revision.revision,
    status,
    paramsHash: revision.paramsHash,
  };
}

async function insertEvent(
  sql: Queryable,
  userId: string,
  event: CanonicalEvent,
) {
  await sql.unsafe(
    `INSERT INTO fsrs_review_events (
       request_id, user_id, card_id, learning_cycle, sequence, rating,
       reviewed_at, received_at, duration_ms, parameter_revision_id, origin,
       before_state, before_due_at, before_stability, before_difficulty,
       before_scheduled_days, before_learning_steps, elapsed_days,
       after_state, after_due_at, after_stability, after_difficulty,
       after_scheduled_days, after_learning_steps, after_reps, after_lapses,
       after_state_version
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::int, $5::int, $6,
       $7::timestamptz, $8::timestamptz, $9::int, $10::uuid, 'live',
       $11, $12::timestamptz, $13::double precision,
       $14::double precision, $15::int, $16::int, $17::int,
       $18, $19::timestamptz, $20::double precision,
       $21::double precision, $22::int, $23::int, $24::int, $25::int,
       $26::bigint
     )`,
    [
      event.requestId,
      userId,
      event.cardId,
      event.learningCycle,
      event.sequence,
      event.rating,
      event.reviewedAt,
      event.receivedAt,
      event.durationMs,
      event.parameterRevisionId,
      event.beforeState,
      bindTimestamp(event.beforeDueAt),
      event.beforeStability,
      event.beforeDifficulty,
      event.beforeScheduledDays,
      event.beforeLearningSteps,
      event.elapsedDays,
      event.afterState,
      bindTimestamp(event.afterDueAt),
      event.afterStability,
      event.afterDifficulty,
      event.afterScheduledDays,
      event.afterLearningSteps,
      event.afterReps,
      event.afterLapses,
      event.afterStateVersion,
    ],
  );
}

async function upsertState(
  sql: Queryable,
  userId: string,
  cardId: string,
  card: Card,
  parameterRevisionId: string,
  learningCycle: number,
  stateVersion: number,
  updatedAt: string,
) {
  if (!card.last_review) {
    throw new ValidationError('FSRS scheduler omitted last review');
  }
  await sql.unsafe(
    `INSERT INTO fsrs_card_states (
       user_id, card_id, next_review_at, last_reviewed_at, stability,
       difficulty, state, elapsed_days, scheduled_days, learning_steps,
       reps, lapses, parameter_revision_id, state_version, learning_cycle,
       updated_at
     ) VALUES (
       $1::uuid, $2::uuid, $3::timestamptz, $4::timestamptz,
       $5::double precision, $6::double precision, $7, $8::int, $9::int,
       $10::int, $11::int, $12::int, $13::uuid, $14::bigint, $15::int,
       $16::timestamptz
     )
     ON CONFLICT (user_id, card_id)
     DO UPDATE SET
       next_review_at = EXCLUDED.next_review_at,
       last_reviewed_at = EXCLUDED.last_reviewed_at,
       stability = EXCLUDED.stability,
       difficulty = EXCLUDED.difficulty,
       state = EXCLUDED.state,
       elapsed_days = EXCLUDED.elapsed_days,
       scheduled_days = EXCLUDED.scheduled_days,
       learning_steps = EXCLUDED.learning_steps,
       reps = EXCLUDED.reps,
       lapses = EXCLUDED.lapses,
       parameter_revision_id = EXCLUDED.parameter_revision_id,
       state_version = EXCLUDED.state_version,
       learning_cycle = EXCLUDED.learning_cycle,
       updated_at = EXCLUDED.updated_at`,
    [
      userId,
      cardId,
      bindTimestamp(card.due),
      bindTimestamp(card.last_review),
      card.stability,
      card.difficulty,
      persistedState(card.state),
      card.elapsed_days,
      card.scheduled_days,
      card.learning_steps,
      card.reps,
      card.lapses,
      parameterRevisionId,
      stateVersion,
      learningCycle,
      updatedAt,
    ],
  );
}

async function lockResetDependencies(
  sql: Queryable,
  userId: string,
  cardIds: readonly string[],
) {
  if (cardIds.length === 0) return;
  await sql.unsafe(
    `SELECT request_id
     FROM fsrs_review_events
     WHERE user_id = $1::uuid
       AND card_id = ANY($2::uuid[])
     ORDER BY card_id, learning_cycle, sequence
     FOR UPDATE`,
    [userId, cardIds],
  );
  const states = await lockStates(sql, userId, cardIds);
  const revisionIds = sortedUniqueText(
    states.map((state) => state.parameterRevisionId),
  );
  if (revisionIds.length > 0) {
    await sql.unsafe(
      `SELECT id
       FROM fsrs_parameter_revisions
       WHERE user_id = $1::uuid
         AND id = ANY($2::uuid[])
       ORDER BY id
       FOR UPDATE`,
      [userId, revisionIds],
    );
  }
}

interface CanonicalState {
  cardId: string;
  nextReviewAt: Date;
  lastReviewedAt: Date;
  stability: number;
  difficulty: number;
  state: PersistedFsrsState;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  parameterRevisionId: string;
  stateVersion: number;
  learningCycle: number;
}

interface CanonicalEvent extends LiveReviewEventSnapshot {
  receivedAt: string;
  parameterRevisionId: string;
  beforeState: PersistedFsrsState | null;
  beforeDueAt: Date | null;
  beforeStability: number | null;
  beforeDifficulty: number | null;
  beforeScheduledDays: number | null;
  beforeLearningSteps: number | null;
  elapsedDays: number;
  afterLearningSteps: number;
  afterReps: number;
  afterLapses: number;
  afterStateVersion: number;
}

function persistedStateFromRow(row: PersistedStateRow): CanonicalState {
  const stateVersion = Number(row.stateVersion);
  return {
    ...row,
    stateVersion,
  };
}

function cardFromState(state: CanonicalState): Card {
  return {
    due: new Date(state.nextReviewAt),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsedDays,
    scheduled_days: state.scheduledDays,
    reps: state.reps,
    lapses: state.lapses,
    learning_steps: state.learningSteps,
    state: fsrsState(state.state),
    last_review: new Date(state.lastReviewedAt),
  };
}

function stateFromScheduledCard(
  cardId: string,
  card: Card,
  parameterRevisionId: string,
  learningCycle: number,
  stateVersion: number,
): CanonicalState {
  if (!card.last_review) {
    throw new ValidationError('FSRS scheduler omitted last review');
  }
  return {
    cardId,
    nextReviewAt: new Date(card.due),
    lastReviewedAt: new Date(card.last_review),
    stability: card.stability,
    difficulty: card.difficulty,
    state: persistedState(card.state),
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    parameterRevisionId,
    stateVersion,
    learningCycle,
  };
}

function eventFromSchedule(
  command: NormalizedLiveReviewCommand,
  before: CanonicalState | null,
  after: Card,
  elapsedDays: number,
  parameterRevisionId: string,
  learningCycle: number,
  sequence: number,
): CanonicalEvent {
  return {
    requestId: command.requestId,
    cardId: command.cardId,
    rating: command.rating,
    reviewedAt: command.reviewedAt,
    receivedAt: command.receivedAt,
    durationMs: command.durationMs,
    origin: 'live',
    learningCycle,
    sequence,
    parameterRevisionId,
    beforeState: before?.state ?? null,
    beforeDueAt: before ? new Date(before.nextReviewAt) : null,
    beforeStability: before?.stability ?? null,
    beforeDifficulty: before?.difficulty ?? null,
    beforeScheduledDays: before?.scheduledDays ?? null,
    beforeLearningSteps: before?.learningSteps ?? null,
    elapsedDays,
    afterState: persistedState(after.state),
    afterDueAt: new Date(after.due),
    afterStability: after.stability,
    afterDifficulty: after.difficulty,
    afterScheduledDays: after.scheduled_days,
    afterLearningSteps: after.learning_steps,
    afterReps: after.reps,
    afterLapses: after.lapses,
    afterStateVersion: sequence,
  };
}

function validateScheduledProjection(
  card: Card,
  sequence: number,
  reviewedAt: Date,
) {
  if (
    !card.last_review ||
    card.last_review.getTime() !== reviewedAt.getTime() ||
    card.reps !== sequence ||
    !Number.isInteger(card.lapses) ||
    card.lapses < 0 ||
    card.lapses > card.reps
  ) {
    throw new ValidationError(
      'FSRS scheduler result violates canonical state projection',
    );
  }
  persistedState(card.state);
}

function persistedState(state: State): PersistedFsrsState {
  if (state === State.Learning) return 'learning';
  if (state === State.Review) return 'review';
  if (state === State.Relearning) return 'relearning';
  throw new ValidationError('FSRS scheduler returned an invalid state');
}

function fsrsState(state: PersistedFsrsState): State {
  if (state === 'learning') return State.Learning;
  if (state === 'review') return State.Review;
  return State.Relearning;
}

async function retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt === MAX_TRANSACTION_ATTEMPTS) {
        throw error;
      }
    }
  }
  throw lastError;
}

function isRetryableTransactionError(error: unknown) {
  if (!isRecord(error)) return false;
  return (
    typeof error.code === 'string' &&
    RETRYABLE_TRANSACTION_CODES.has(error.code)
  );
}

function sortedUniqueText(values: readonly string[]): string[] {
  return [...new Set(values)].sort(asciiCompare);
}

function sameOrderedText(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function asciiCompare(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
