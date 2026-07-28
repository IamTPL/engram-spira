import type { Sql } from 'postgres';

import { pgClient } from '../../db';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors';
import type {
  ExistingVerifierSuggestion,
  PersistedVerifierSuggestion,
  SuggestionPersistenceFence,
  SuggestionPersistenceRepository,
  SuggestionPersistenceResult,
} from './kg-verification.service';

type SuggestionSql = Sql;

type WritableRun = {
  id: string;
  deckId: string | null;
  status: string;
  stage: string;
  lockedBy: string | null;
  leaseActive: boolean;
  cancelRequestedAt: Date | null;
  embeddingModel: string;
  representationVersion: string;
  promptVersion: string;
  taxonomyVersion: string;
};

function uniqueNonNull(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

async function assertWritableRun(
  sql: SuggestionSql,
  fence: SuggestionPersistenceFence,
): Promise<WritableRun> {
  const rows = await sql<WritableRun[]>`
    SELECT
      id,
      deck_id AS "deckId",
      status,
      stage,
      locked_by AS "lockedBy",
      COALESCE(locked_until > now(), false) AS "leaseActive",
      cancel_requested_at AS "cancelRequestedAt",
      embedding_model AS "embeddingModel",
      representation_version AS "representationVersion",
      prompt_version AS "promptVersion",
      taxonomy_version AS "taxonomyVersion"
    FROM kg_runs
    WHERE id = ${fence.runId}
      AND user_id = ${fence.userId}
    FOR UPDATE
  `;
  const run = rows[0];
  if (!run) throw new NotFoundError('Knowledge graph run');
  if (
    run.deckId !== fence.deckId ||
    run.status !== 'processing' ||
    run.stage !== 'verification' ||
    run.lockedBy !== fence.workerId ||
    !run.leaseActive ||
    run.cancelRequestedAt !== null
  ) {
    throw new ConflictError('Knowledge graph run is no longer writable');
  }
  return run;
}

async function assertOwnedCards(
  sql: SuggestionSql,
  userId: string,
  deckId: string,
  cardIds: string[],
): Promise<void> {
  if (cardIds.length === 0) return;
  const rows = await sql<{ id: string }[]>`
    SELECT c.id
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    WHERE d.user_id = ${userId}
      AND c.deck_id = ${deckId}
      AND c.id = ANY(${sql.array(cardIds)}::uuid[])
  `;
  if (rows.length !== cardIds.length) throw new NotFoundError('Card');
}

async function assertOwnedSenses(
  sql: SuggestionSql,
  userId: string,
  senseIds: string[],
): Promise<void> {
  if (senseIds.length === 0) return;
  const rows = await sql<{ id: string }[]>`
    SELECT ls.id
    FROM lexical_senses ls
    JOIN lexemes l ON l.id = ls.lexeme_id
    WHERE l.user_id = ${userId}
      AND ls.id = ANY(${sql.array(senseIds)}::uuid[])
  `;
  if (rows.length !== senseIds.length) {
    throw new NotFoundError('Lexical sense');
  }
}

function assertRecords(
  fence: SuggestionPersistenceFence,
  records: PersistedVerifierSuggestion[],
): void {
  for (const record of records) {
    if (record.userId !== fence.userId || record.runId !== fence.runId) {
      throw new ValidationError(
        'Suggestion persistence records must belong to one run',
      );
    }
    if (
      record.sourceCardId === null &&
      record.sourceSenseId === null
    ) {
      throw new ValidationError('Suggestion source endpoint is required');
    }
    if (
      !/^[a-f0-9]{64}$/.test(record.fingerprint) ||
      !/^[a-f0-9]{64}$/.test(record.sourceContentHash) ||
      !/^[a-f0-9]{64}$/.test(record.targetContentHash)
    ) {
      throw new ValidationError('Invalid suggestion fingerprint provenance');
    }
  }
}

async function reattachCurrentPendingSuggestions(
  sql: SuggestionSql,
  fence: SuggestionPersistenceFence,
  run: WritableRun,
): Promise<void> {
  await sql`
    UPDATE kg_relation_suggestions AS suggestion
    SET
      run_id = ${fence.runId},
      updated_at = now()
    FROM
      cards AS source_card,
      cards AS target_card,
      card_embedding_metadata AS source_metadata,
      card_embedding_metadata AS target_metadata,
      kg_runs AS prior_run
    WHERE suggestion.user_id = ${fence.userId}
      AND suggestion.status = 'pending'
      AND suggestion.decision = 'relation'
      AND suggestion.run_id <> ${fence.runId}
      AND prior_run.id = suggestion.run_id
      AND prior_run.embedding_model = ${run.embeddingModel}
      AND prior_run.representation_version = ${run.representationVersion}
      AND prior_run.prompt_version = ${run.promptVersion}
      AND prior_run.taxonomy_version = ${run.taxonomyVersion}
      AND source_card.id = suggestion.source_card_id
      AND source_card.deck_id = ${fence.deckId}
      AND target_card.id = suggestion.target_card_id
      AND target_card.deck_id = ${fence.deckId}
      AND source_metadata.card_id = source_card.id
      AND source_metadata.model = ${run.embeddingModel}
      AND source_metadata.dimensions = 768
      AND source_metadata.representation_version = ${run.representationVersion}
      AND source_metadata.content_hash = suggestion.source_content_hash
      AND target_metadata.card_id = target_card.id
      AND target_metadata.model = ${run.embeddingModel}
      AND target_metadata.dimensions = 768
      AND target_metadata.representation_version = ${run.representationVersion}
      AND target_metadata.content_hash = suggestion.target_content_hash
  `;
}

async function countCurrentPendingSuggestions(
  sql: SuggestionSql,
  fence: SuggestionPersistenceFence,
  run: WritableRun,
): Promise<number> {
  const rows = await sql<{ count: number | string }[]>`
    SELECT count(*)::int AS count
    FROM kg_relation_suggestions AS suggestion
    JOIN cards AS source_card
      ON source_card.id = suggestion.source_card_id
    JOIN cards AS target_card
      ON target_card.id = suggestion.target_card_id
    JOIN card_embedding_metadata AS source_metadata
      ON source_metadata.card_id = source_card.id
    JOIN card_embedding_metadata AS target_metadata
      ON target_metadata.card_id = target_card.id
    WHERE suggestion.run_id = ${fence.runId}
      AND suggestion.user_id = ${fence.userId}
      AND suggestion.status = 'pending'
      AND suggestion.decision = 'relation'
      AND source_card.deck_id = ${fence.deckId}
      AND target_card.deck_id = ${fence.deckId}
      AND source_metadata.model = ${run.embeddingModel}
      AND source_metadata.dimensions = 768
      AND source_metadata.representation_version = ${run.representationVersion}
      AND source_metadata.content_hash = suggestion.source_content_hash
      AND target_metadata.model = ${run.embeddingModel}
      AND target_metadata.dimensions = 768
      AND target_metadata.representation_version = ${run.representationVersion}
      AND target_metadata.content_hash = suggestion.target_content_hash
  `;
  return Number(rows[0]?.count ?? 0);
}

async function persistSuggestions(
  sql: SuggestionSql,
  fence: SuggestionPersistenceFence,
  records: PersistedVerifierSuggestion[],
): Promise<SuggestionPersistenceResult> {
  assertRecords(fence, records);
  const cardIds = uniqueNonNull(
    records.flatMap((record) => [
      record.sourceCardId,
      record.targetCardId,
    ]),
  );
  const senseIds = uniqueNonNull(
    records.flatMap((record) => [
      record.sourceSenseId,
      record.targetSenseId,
    ]),
  );

  return sql.begin(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as SuggestionSql;
    const run = await assertWritableRun(transaction, fence);
    await assertOwnedCards(
      transaction,
      fence.userId,
      fence.deckId,
      cardIds,
    );
    await assertOwnedSenses(transaction, fence.userId, senseIds);
    await reattachCurrentPendingSuggestions(transaction, fence, run);

    const input = records.map((record) => ({
      runId: record.runId,
      userId: record.userId,
      sourceCardId: record.sourceCardId,
      targetCardId: record.targetCardId,
      sourceSenseId: record.sourceSenseId,
      targetSenseId: record.targetSenseId,
      sourceArtifact: record.sourceArtifact,
      targetArtifact: record.targetArtifact,
      sourceContentHash: record.sourceContentHash,
      targetContentHash: record.targetContentHash,
      decision: record.decision,
      relationType: record.relationType,
      direction: record.direction,
      confidenceBand: record.confidenceBand,
      reason: record.reason,
      evidence: record.evidence,
      retrievalSimilarity: record.retrievalSimilarity,
      mutualKnn: record.mutualKnn,
      fingerprint: record.fingerprint,
      status: record.status,
    }));
    const persisted = await transaction<{ id: string }[]>`
      INSERT INTO kg_relation_suggestions (
        run_id,
        user_id,
        source_card_id,
        target_card_id,
        source_sense_id,
        target_sense_id,
        source_artifact,
        target_artifact,
        source_content_hash,
        target_content_hash,
        decision,
        relation_type,
        direction,
        confidence_band,
        reason,
        evidence,
        retrieval_similarity,
        mutual_knn,
        fingerprint,
        status
      )
      SELECT
        candidate."runId",
        candidate."userId",
        candidate."sourceCardId",
        candidate."targetCardId",
        candidate."sourceSenseId",
        candidate."targetSenseId",
        candidate."sourceArtifact",
        candidate."targetArtifact",
        candidate."sourceContentHash",
        candidate."targetContentHash",
        candidate.decision,
        candidate."relationType",
        candidate.direction,
        candidate."confidenceBand",
        candidate.reason,
        candidate.evidence,
        candidate."retrievalSimilarity",
        candidate."mutualKnn",
        candidate.fingerprint,
        candidate.status
      FROM jsonb_to_recordset(${transaction.json(
        input as unknown as Parameters<SuggestionSql['json']>[0],
      )}) AS candidate(
        "runId" uuid,
        "userId" uuid,
        "sourceCardId" uuid,
        "targetCardId" uuid,
        "sourceSenseId" uuid,
        "targetSenseId" uuid,
        "sourceArtifact" jsonb,
        "targetArtifact" jsonb,
        "sourceContentHash" text,
        "targetContentHash" text,
        decision text,
        "relationType" text,
        direction text,
        "confidenceBand" text,
        reason text,
        evidence jsonb,
        "retrievalSimilarity" real,
        "mutualKnn" boolean,
        fingerprint text,
        status text
      )
      ON CONFLICT (user_id, fingerprint)
      DO UPDATE SET
        run_id = EXCLUDED.run_id,
        source_card_id = EXCLUDED.source_card_id,
        target_card_id = EXCLUDED.target_card_id,
        source_sense_id = EXCLUDED.source_sense_id,
        target_sense_id = EXCLUDED.target_sense_id,
        source_artifact = EXCLUDED.source_artifact,
        target_artifact = EXCLUDED.target_artifact,
        source_content_hash = EXCLUDED.source_content_hash,
        target_content_hash = EXCLUDED.target_content_hash,
        decision = EXCLUDED.decision,
        relation_type = EXCLUDED.relation_type,
        direction = EXCLUDED.direction,
        confidence_band = EXCLUDED.confidence_band,
        reason = EXCLUDED.reason,
        evidence = EXCLUDED.evidence,
        retrieval_similarity = EXCLUDED.retrieval_similarity,
        mutual_knn = EXCLUDED.mutual_knn,
        status = EXCLUDED.status,
        updated_at = now()
      WHERE kg_relation_suggestions.status = 'rejected'
        AND kg_relation_suggestions.decision = 'abstain'
      RETURNING id
    `;
    const pending = await countCurrentPendingSuggestions(
      transaction,
      fence,
      run,
    );
    return { persisted: persisted.length, pending };
  });
}

export function createPostgresSuggestionPersistenceRepository(
  sql: SuggestionSql = pgClient,
): SuggestionPersistenceRepository {
  return {
    async loadExistingSuggestions(userId, fingerprints) {
      if (fingerprints.length === 0) return [];
      return sql<ExistingVerifierSuggestion[]>`
        SELECT
          fingerprint,
          run_id AS "runId",
          decision,
          status
        FROM kg_relation_suggestions
        WHERE user_id = ${userId}
          AND fingerprint = ANY(${sql.array(fingerprints)}::text[])
        ORDER BY fingerprint
      `;
    },
    persistSuggestions: (fence, records) =>
      persistSuggestions(sql, fence, records),
  };
}
