import type { TransactionSql } from 'postgres';
import { NotFoundError, ValidationError } from '../../shared/errors';
import {
  nullableTimestampFromRow,
  timestampFromRow,
  type PgTimestamp,
} from '../../db/pg-codecs';
import { canonicalUuid } from './fsrs-live.domain';
import {
  validateCanonicalFsrsRead,
  type CanonicalFsrsParameterRevision,
  type CanonicalFsrsRead,
  type CanonicalFsrsCardState,
} from './fsrs-retention';

type Queryable = Pick<TransactionSql, 'unsafe'>;

interface CanonicalFsrsReadRow {
  ordinal: number;
  requestedCardId: string;
  ownedCardId: string | null;
  stateId: string | null;
  stateUserId: string | null;
  stateCardId: string | null;
  nextReviewAt: PgTimestamp | null;
  lastReviewedAt: PgTimestamp | null;
  stability: number | null;
  difficulty: number | null;
  state: string | null;
  elapsedDays: number | null;
  scheduledDays: number | null;
  learningSteps: number | null;
  reps: number | null;
  lapses: number | null;
  parameterRevisionId: string | null;
  stateVersion: string | null;
  learningCycle: number | null;
  stateUpdatedAt: PgTimestamp | null;
  revisionId: string | null;
  revisionUserId: string | null;
  revisionNumber: number | null;
  engineVersion: string | null;
  algorithmVersion: string | null;
  policyVersion: string | null;
  parameters: unknown;
  paramsHash: string | null;
  revisionSource: string | null;
  revisionCreatedAt: PgTimestamp | null;
  revisionActivatedAt: PgTimestamp | null;
  revisionRetiredAt: PgTimestamp | null;
}

export interface CanonicalFsrsCardRead {
  cardId: string;
  read: CanonicalFsrsRead | null;
}

export interface CanonicalFsrsReadLoader {
  loadByCardIds(
    userId: string,
    cardIds: readonly string[],
  ): Promise<CanonicalFsrsCardRead[]>;
}

export function createPostgresCanonicalFsrsReadLoader(
  sql: Queryable,
): CanonicalFsrsReadLoader {
  return {
    async loadByCardIds(userId, cardIds) {
      const canonicalUserId = canonicalUuid(userId, 'User id');
      if (!Array.isArray(cardIds)) {
        throw new ValidationError('Card ids must be an array');
      }
      const canonicalCardIds = cardIds.map((cardId, index) =>
        canonicalUuid(cardId, `Card id ${index + 1}`),
      );
      if (new Set(canonicalCardIds).size !== canonicalCardIds.length) {
        throw new ValidationError('Card ids must be unique');
      }
      if (canonicalCardIds.length === 0) return [];

      const rows = await sql.unsafe<CanonicalFsrsReadRow[]>(
        `WITH requested AS (
           SELECT
             card_id,
             ordinality::int AS ordinal
           FROM unnest($2::uuid[]) WITH ORDINALITY
             AS input(card_id, ordinality)
         )
         SELECT
           requested.ordinal,
           requested.card_id::text AS "requestedCardId",
           CASE
             WHEN owned_deck.id IS NULL THEN NULL
             ELSE owned_card.id::text
           END AS "ownedCardId",
           state.id::text AS "stateId",
           state.user_id::text AS "stateUserId",
           state.card_id::text AS "stateCardId",
           state.next_review_at AS "nextReviewAt",
           state.last_reviewed_at AS "lastReviewedAt",
           state.stability,
           state.difficulty,
           state.state,
           state.elapsed_days AS "elapsedDays",
           state.scheduled_days AS "scheduledDays",
           state.learning_steps AS "learningSteps",
           state.reps,
           state.lapses,
           state.parameter_revision_id::text AS "parameterRevisionId",
           state.state_version::text AS "stateVersion",
           state.learning_cycle AS "learningCycle",
           state.updated_at AS "stateUpdatedAt",
           revision.id::text AS "revisionId",
           revision.user_id::text AS "revisionUserId",
           revision.revision AS "revisionNumber",
           revision.engine_version AS "engineVersion",
           revision.algorithm_version AS "algorithmVersion",
           revision.policy_version AS "policyVersion",
           revision.parameters,
           revision.params_hash AS "paramsHash",
           revision.source AS "revisionSource",
           revision.created_at AS "revisionCreatedAt",
           revision.activated_at AS "revisionActivatedAt",
           revision.retired_at AS "revisionRetiredAt"
         FROM requested
         LEFT JOIN cards AS owned_card
           ON owned_card.id = requested.card_id
         LEFT JOIN decks AS owned_deck
           ON owned_deck.id = owned_card.deck_id
          AND owned_deck.user_id = $1::uuid
         LEFT JOIN fsrs_card_states AS state
           ON owned_deck.id IS NOT NULL
          AND state.user_id = $1::uuid
          AND state.card_id = owned_card.id
         LEFT JOIN fsrs_parameter_revisions AS revision
           ON revision.id = state.parameter_revision_id
          AND revision.user_id = state.user_id
         ORDER BY requested.ordinal`,
        [canonicalUserId, canonicalCardIds],
      );

      if (rows.length !== canonicalCardIds.length) {
        throw new ValidationError(
          'Canonical FSRS read query must return exactly one row per requested card',
        );
      }

      return rows.map((row, index) =>
        readRow(row, index, canonicalUserId, canonicalCardIds[index]!),
      );
    },
  };
}

function readRow(
  row: CanonicalFsrsReadRow,
  index: number,
  userId: string,
  cardId: string,
): CanonicalFsrsCardRead {
  if (
    row.ordinal !== index + 1 ||
    row.requestedCardId !== cardId
  ) {
    throw new ValidationError(
      'Canonical FSRS read query returned an unstable card mapping',
    );
  }
  if (row.ownedCardId === null) {
    throw new NotFoundError('Card');
  }
  if (row.ownedCardId !== cardId) {
    throw new ValidationError(
      'Canonical FSRS read query returned a mismatched owned card',
    );
  }
  if (row.stateId === null) {
    if (hasAnyCanonicalStateOrRevisionValue(row)) {
      throw new ValidationError(
        'Canonical FSRS read query returned a partial New-card row',
      );
    }
    return { cardId, read: null };
  }
  if (
    row.revisionId === null ||
    row.revisionUserId === null ||
    row.revisionNumber === null ||
    row.engineVersion === null ||
    row.algorithmVersion === null ||
    row.policyVersion === null ||
    row.parameters === null ||
    row.paramsHash === null ||
    row.revisionSource === null ||
    row.revisionCreatedAt === null ||
    row.revisionActivatedAt === null
  ) {
    throw new ValidationError(
      'Canonical FSRS state is missing its parameter revision',
    );
  }

  const state = stateFromRow(row);
  const revision = revisionFromRow(row);
  const read = validateCanonicalFsrsRead({ state, revision });
  if (read.state.userId !== userId) {
    throw new ValidationError(
      'Canonical FSRS state is outside the requested owner scope',
    );
  }
  return { cardId, read };
}

function stateFromRow(
  row: CanonicalFsrsReadRow,
): CanonicalFsrsCardState {
  const required = {
    stateUserId: row.stateUserId,
    stateCardId: row.stateCardId,
    nextReviewAt: row.nextReviewAt,
    lastReviewedAt: row.lastReviewedAt,
    stability: row.stability,
    difficulty: row.difficulty,
    state: row.state,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    parameterRevisionId: row.parameterRevisionId,
    stateVersion: row.stateVersion,
    learningCycle: row.learningCycle,
    stateUpdatedAt: row.stateUpdatedAt,
  };
  if (Object.values(required).some((value) => value === null)) {
    throw new ValidationError(
      'Canonical FSRS state row is incomplete',
    );
  }
  if (!/^[1-9]\d*$/u.test(row.stateVersion!)) {
    throw new ValidationError(
      'Canonical FSRS state version is invalid',
    );
  }
  return {
    id: row.stateId!,
    userId: row.stateUserId!,
    cardId: row.stateCardId!,
    nextReviewAt: timestampFromRow(row.nextReviewAt, 'FSRS state nextReviewAt'),
    lastReviewedAt: timestampFromRow(
      row.lastReviewedAt,
      'FSRS state lastReviewedAt',
    ),
    stability: row.stability!,
    difficulty: row.difficulty!,
    state: row.state as CanonicalFsrsCardState['state'],
    elapsedDays: row.elapsedDays!,
    scheduledDays: row.scheduledDays!,
    learningSteps: row.learningSteps!,
    reps: row.reps!,
    lapses: row.lapses!,
    parameterRevisionId: row.parameterRevisionId!,
    stateVersion: Number(row.stateVersion),
    learningCycle: row.learningCycle!,
    updatedAt: timestampFromRow(row.stateUpdatedAt, 'FSRS state updatedAt'),
  };
}

function revisionFromRow(
  row: CanonicalFsrsReadRow,
): CanonicalFsrsParameterRevision {
  return {
    id: row.revisionId!,
    userId: row.revisionUserId!,
    revision: row.revisionNumber!,
    engineVersion: row.engineVersion!,
    algorithmVersion: row.algorithmVersion!,
    policyVersion: row.policyVersion!,
    parameters: row.parameters as Record<string, unknown>,
    paramsHash: row.paramsHash!,
    source: row.revisionSource as CanonicalFsrsParameterRevision['source'],
    createdAt: timestampFromRow(
      row.revisionCreatedAt,
      'FSRS parameter revision createdAt',
    ),
    activatedAt: timestampFromRow(
      row.revisionActivatedAt,
      'FSRS parameter revision activatedAt',
    ),
    retiredAt: nullableTimestampFromRow(
      row.revisionRetiredAt,
      'FSRS parameter revision retiredAt',
    ),
  };
}

function hasAnyCanonicalStateOrRevisionValue(
  row: CanonicalFsrsReadRow,
): boolean {
  return [
    row.stateUserId,
    row.stateCardId,
    row.nextReviewAt,
    row.lastReviewedAt,
    row.stability,
    row.difficulty,
    row.state,
    row.elapsedDays,
    row.scheduledDays,
    row.learningSteps,
    row.reps,
    row.lapses,
    row.parameterRevisionId,
    row.stateVersion,
    row.learningCycle,
    row.stateUpdatedAt,
    row.revisionId,
    row.revisionUserId,
    row.revisionNumber,
    row.engineVersion,
    row.algorithmVersion,
    row.policyVersion,
    row.parameters,
    row.paramsHash,
    row.revisionSource,
    row.revisionCreatedAt,
    row.revisionActivatedAt,
    row.revisionRetiredAt,
  ].some((value) => value !== null && value !== undefined);
}
