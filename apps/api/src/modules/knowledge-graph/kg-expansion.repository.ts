import type { Sql } from 'postgres';

import { pgClient } from '../../db';
import { ValidationError } from '../../shared/errors';
import {
  buildSenseExpansionArtifact,
  type PersistedSenseExpansionSuggestion,
  type SenseExpansionPersistenceFence,
  type SenseExpansionPersistenceResult,
  type SenseExpansionRepository,
  type SenseExpansionSource,
} from './kg-expansion.service';
import type {
  RelationDirection,
  RelationType,
} from './kg-verifier';

type ExpansionSql = Sql;

type SenseRow = {
  senseId: string;
  lexemeId: string;
  sourceLanguageTag: string;
  definitionLanguageTag: string;
  lemma: string;
  normalizedLemma: string;
  partOfSpeech: string;
  definition: string;
  normalizedDefinition: string;
  ipa: string | null;
  examples: unknown;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const symmetricRelationTypes = new Set<RelationType>([
  'synonym',
  'antonym',
  'collocation',
  'confused_with',
  'translation_of',
  'coordinate',
]);

function toSource(row: SenseRow): SenseExpansionSource {
  if (
    !Array.isArray(row.examples) ||
    !row.examples.every((example) => typeof example === 'string')
  ) {
    throw new ValidationError('Invalid lexical sense examples');
  }
  return {
    ...row,
    examples: row.examples,
  };
}

async function loadOwnedSense(
  sql: ExpansionSql,
  userId: string,
  senseId: string,
  lock = false,
): Promise<SenseExpansionSource | null> {
  const rows = await sql.unsafe<SenseRow[]>(
    `
      SELECT
        sense.id AS "senseId",
        sense.lexeme_id AS "lexemeId",
        lexeme.language_tag AS "sourceLanguageTag",
        sense.definition_language_tag AS "definitionLanguageTag",
        lexeme.lemma,
        lexeme.normalized_lemma AS "normalizedLemma",
        sense.part_of_speech AS "partOfSpeech",
        sense.definition,
        sense.normalized_definition AS "normalizedDefinition",
        sense.ipa,
        sense.examples
      FROM lexical_senses sense
      JOIN lexemes lexeme ON lexeme.id = sense.lexeme_id
      WHERE sense.id = $1
        AND lexeme.user_id = $2
      ${lock ? 'FOR SHARE OF sense, lexeme' : ''}
    `,
    [senseId, userId],
  );
  return rows[0] ? toSource(rows[0]) : null;
}

function orientRelation(
  relationType: RelationType,
  direction: RelationDirection,
  sourceSenseId: string,
  targetSenseId: string,
): [string, string] {
  if (symmetricRelationTypes.has(relationType)) {
    return sourceSenseId < targetSenseId
      ? [sourceSenseId, targetSenseId]
      : [targetSenseId, sourceSenseId];
  }
  return direction === 'source_to_target'
    ? [sourceSenseId, targetSenseId]
    : [targetSenseId, sourceSenseId];
}

async function findOwnedTargetSense(
  sql: ExpansionSql,
  userId: string,
  suggestion: PersistedSenseExpansionSuggestion,
): Promise<string | null> {
  const target = suggestion.targetArtifact;
  const rows = await sql<{ id: string }[]>`
    SELECT sense.id
    FROM lexical_senses sense
    JOIN lexemes lexeme ON lexeme.id = sense.lexeme_id
    WHERE lexeme.user_id = ${userId}
      AND lexeme.language_tag = ${target.sourceLanguageTag}
      AND lexeme.normalized_lemma = ${target.normalizedLemma}
      AND sense.part_of_speech = ${target.partOfSpeech}
      AND sense.definition_language_tag = ${target.definitionLanguageTag}
      AND sense.normalized_definition = ${target.normalizedDefinition}
    ORDER BY sense.id
    LIMIT 1
    FOR SHARE OF sense, lexeme
  `;
  return rows[0]?.id ?? null;
}

async function relationAlreadyExists(
  sql: ExpansionSql,
  userId: string,
  focusSenseId: string,
  targetSenseId: string | null,
  suggestion: PersistedSenseExpansionSuggestion,
): Promise<boolean> {
  if (targetSenseId === null) return false;
  if (targetSenseId === focusSenseId) return true;
  const [sourceSenseId, orientedTargetSenseId] = orientRelation(
    suggestion.relationType,
    suggestion.direction,
    focusSenseId,
    targetSenseId,
  );
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM sense_relations relation
      WHERE relation.user_id = ${userId}
        AND relation.source_sense_id = ${sourceSenseId}
        AND relation.target_sense_id = ${orientedTargetSenseId}
        AND relation.relation_type = ${suggestion.relationType}
    ) AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

async function persistSuggestions(
  sql: ExpansionSql,
  fence: SenseExpansionPersistenceFence,
  suggestions: PersistedSenseExpansionSuggestion[],
): Promise<SenseExpansionPersistenceResult> {
  const fingerprints = new Set<string>();
  for (const suggestion of suggestions) {
    if (
      !SHA256_PATTERN.test(suggestion.fingerprint) ||
      fingerprints.has(suggestion.fingerprint)
    ) {
      throw new ValidationError(
        'Expansion suggestions require unique fingerprints',
      );
    }
    fingerprints.add(suggestion.fingerprint);
  }

  return sql.begin(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as ExpansionSql;
    const ownedRuns = await transaction<{ id: string }[]>`
      SELECT id
      FROM kg_runs
      WHERE id = ${fence.runId}
        AND user_id = ${fence.userId}
        AND run_type = 'sense_expansion'
        AND focus_sense_id = ${fence.focusSenseId}
        AND status = 'processing'
        AND stage = 'persistence'
        AND locked_by = ${fence.workerId}
        AND locked_until > now()
        AND cancel_requested_at IS NULL
      FOR UPDATE
    `;
    if (!ownedRuns[0]) return { outcome: 'superseded' as const };

    const current = await loadOwnedSense(
      transaction,
      fence.userId,
      fence.focusSenseId,
      true,
    );
    if (current === null) return { outcome: 'stale' as const };
    let currentArtifact;
    try {
      currentArtifact = buildSenseExpansionArtifact(current);
    } catch (error) {
      if (error instanceof ValidationError) {
        return { outcome: 'stale' as const };
      }
      throw error;
    }
    if (
      fence.expectedFocus.cardId !== fence.focusSenseId ||
      currentArtifact.contentHash !== fence.expectedFocus.contentHash
    ) {
      return { outcome: 'stale' as const };
    }

    let persisted = 0;
    const eligibleFingerprints: string[] = [];
    for (const suggestion of suggestions) {
      const targetSenseId = await findOwnedTargetSense(
        transaction,
        fence.userId,
        suggestion,
      );
      if (
        await relationAlreadyExists(
          transaction,
          fence.userId,
          fence.focusSenseId,
          targetSenseId,
          suggestion,
        )
      ) {
        continue;
      }
      eligibleFingerprints.push(suggestion.fingerprint);
      const inserted = await transaction<{ id: string }[]>`
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
        VALUES (
          ${fence.runId},
          ${fence.userId},
          NULL,
          NULL,
          ${fence.focusSenseId},
          ${targetSenseId},
          ${transaction.json({ ...fence.expectedFocus })},
          ${transaction.json({ ...suggestion.targetArtifact })},
          ${fence.expectedFocus.contentHash},
          ${suggestion.targetArtifact.contentHash},
          'relation',
          ${suggestion.relationType},
          ${suggestion.direction},
          ${suggestion.confidenceBand},
          ${suggestion.reason},
          ${transaction.json(suggestion.evidence)},
          NULL,
          false,
          ${suggestion.fingerprint},
          'pending'
        )
        ON CONFLICT (user_id, fingerprint)
        DO NOTHING
        RETURNING id
      `;
      persisted += inserted.length;
      if (inserted.length === 0) {
        await transaction`
          UPDATE kg_relation_suggestions
          SET
            run_id = ${fence.runId},
            updated_at = now()
          WHERE user_id = ${fence.userId}
            AND fingerprint = ${suggestion.fingerprint}
            AND status = 'pending'
            AND decision = 'relation'
        `;
      }
    }

    if (eligibleFingerprints.length === 0) {
      return {
        outcome: 'persisted' as const,
        persisted,
        pending: 0,
      };
    }
    const pendingRows = await transaction.unsafe<{ count: number }[]>(
      `
        SELECT count(*)::int AS count
        FROM kg_relation_suggestions
        WHERE run_id = $1
          AND user_id = $2
          AND status = 'pending'
          AND fingerprint = ANY($3::text[])
      `,
      [fence.runId, fence.userId, eligibleFingerprints],
    );
    return {
      outcome: 'persisted' as const,
      persisted,
      pending: pendingRows[0]?.count ?? 0,
    };
  });
}

export function createPostgresSenseExpansionRepository(
  sql: ExpansionSql = pgClient,
): SenseExpansionRepository {
  return {
    loadOwnedSense: (userId, senseId) =>
      loadOwnedSense(sql, userId, senseId),
    persistSuggestions: (fence, suggestions) =>
      persistSuggestions(sql, fence, suggestions),
  };
}
