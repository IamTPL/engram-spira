import type { Sql } from 'postgres';

import { pgClient } from '../../db';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors';
import {
  buildVocabularyArtifact,
  type VocabularyArtifact,
} from './vocabulary-artifact';
import {
  RELATION_TYPES,
  type ConfidenceBand,
  type RelationDirection,
  type RelationType,
} from './kg-verifier';
import type {
  SuggestionAcceptResult,
  SuggestionCursor,
  SuggestionDismissResult,
  SuggestionListStatus,
  SuggestionListRow,
  SuggestionReviewRepository,
  SuggestionStatus,
} from './kg-suggestion-review.service';
import { confidenceScoreForBand } from './kg-confidence';

type SuggestionSql = Sql;

type SuggestionDatabaseRow = {
  id: string;
  runId: string;
  userId: string;
  status: SuggestionStatus;
  decision: string;
  sourceCardId: string | null;
  targetCardId: string | null;
  sourceSenseId: string | null;
  targetSenseId: string | null;
  sourceArtifact: unknown;
  targetArtifact: unknown;
  sourceContentHash: string;
  targetContentHash: string;
  relationType: string | null;
  direction: string | null;
  confidenceBand: string;
  reason: string;
  evidence: unknown;
  retrievalSimilarity: number | null;
  mutualKnn: boolean;
  acceptedRelationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  dismissedAt: Date | null;
  supersededAt: Date | null;
};

type TemplateFieldRow = {
  id: string;
  name: string;
};

type FieldValueRow = {
  templateFieldId: string;
  value: unknown;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const relationTypeSet = new Set<string>(RELATION_TYPES);
const directionSet = new Set<string>([
  'source_to_target',
  'target_to_source',
  'symmetric',
]);
const confidenceBandSet = new Set<string>(['high', 'medium', 'low']);
const symmetricRelationTypes = new Set<RelationType>([
  'synonym',
  'antonym',
  'collocation',
  'confused_with',
  'translation_of',
  'coordinate',
]);

function invalidSuggestionProvenance(): never {
  throw new ValidationError('Invalid suggestion provenance');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseEvidence(
  value: unknown,
): { source: string; target: string } | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.source !== 'string' ||
    typeof value.target !== 'string'
  ) {
    return invalidSuggestionProvenance();
  }
  return { source: value.source, target: value.target };
}

function parseArtifact(
  value: unknown,
  expectedContentHash: string,
): VocabularyArtifact {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 12 ||
    typeof value.cardId !== 'string' ||
    typeof value.sourceLanguageTag !== 'string' ||
    typeof value.definitionLanguageTag !== 'string' ||
    typeof value.lemma !== 'string' ||
    typeof value.normalizedLemma !== 'string' ||
    typeof value.partOfSpeech !== 'string' ||
    typeof value.definition !== 'string' ||
    typeof value.normalizedDefinition !== 'string' ||
    (value.ipa !== null && typeof value.ipa !== 'string') ||
    !Array.isArray(value.examples) ||
    !value.examples.every((example) => typeof example === 'string') ||
    typeof value.contentHash !== 'string' ||
    !SHA256_PATTERN.test(value.contentHash) ||
    value.contentHash !== expectedContentHash ||
    value.representationVersion !== 'v1'
  ) {
    return invalidSuggestionProvenance();
  }

  let rebuilt: VocabularyArtifact;
  try {
    rebuilt = buildVocabularyArtifact({
      cardId: value.cardId,
      sourceLanguageTag: value.sourceLanguageTag,
      definitionLanguageTag: value.definitionLanguageTag,
      templateFields: [
        { id: 'word', name: 'word' },
        { id: 'definition', name: 'definition' },
        { id: 'partOfSpeech', name: 'part of speech' },
        { id: 'ipa', name: 'ipa' },
        { id: 'examples', name: 'examples' },
      ],
      fieldValues: [
        { templateFieldId: 'word', value: value.lemma },
        { templateFieldId: 'definition', value: value.definition },
        { templateFieldId: 'partOfSpeech', value: value.partOfSpeech },
        { templateFieldId: 'ipa', value: value.ipa },
        { templateFieldId: 'examples', value: value.examples },
      ],
    });
  } catch {
    return invalidSuggestionProvenance();
  }
  if (
    rebuilt.contentHash !== expectedContentHash ||
    rebuilt.normalizedLemma !== value.normalizedLemma ||
    rebuilt.normalizedDefinition !== value.normalizedDefinition ||
    rebuilt.partOfSpeech !== value.partOfSpeech
  ) {
    return invalidSuggestionProvenance();
  }
  return rebuilt;
}

function parseRelationType(value: string | null): RelationType {
  if (value === null || !relationTypeSet.has(value)) {
    return invalidSuggestionProvenance();
  }
  return value as RelationType;
}

function parseDirection(value: string | null): RelationDirection {
  if (value === null || !directionSet.has(value)) {
    return invalidSuggestionProvenance();
  }
  return value as RelationDirection;
}

function parseConfidenceBand(value: string): ConfidenceBand {
  if (!confidenceBandSet.has(value)) return invalidSuggestionProvenance();
  return value as ConfidenceBand;
}

function toSuggestionListRow(
  row: SuggestionDatabaseRow,
): SuggestionListRow {
  if (row.decision !== 'relation') return invalidSuggestionProvenance();
  return {
    id: row.id,
    runId: row.runId,
    status: row.status,
    sourceCardId: row.sourceCardId,
    targetCardId: row.targetCardId,
    sourceSenseId: row.sourceSenseId,
    targetSenseId: row.targetSenseId,
    sourceArtifact: parseArtifact(
      row.sourceArtifact,
      row.sourceContentHash,
    ),
    targetArtifact: parseArtifact(
      row.targetArtifact,
      row.targetContentHash,
    ),
    relationType: parseRelationType(row.relationType),
    direction: parseDirection(row.direction),
    confidenceBand: parseConfidenceBand(row.confidenceBand),
    reason: row.reason,
    evidence: parseEvidence(row.evidence),
    retrievalSimilarity: row.retrievalSimilarity,
    mutualKnn: row.mutualKnn,
    acceptedRelationId: row.acceptedRelationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const suggestionSelect = `
  SELECT
    suggestion.id,
    suggestion.run_id AS "runId",
    suggestion.user_id AS "userId",
    suggestion.status,
    suggestion.decision,
    suggestion.source_card_id AS "sourceCardId",
    suggestion.target_card_id AS "targetCardId",
    suggestion.source_sense_id AS "sourceSenseId",
    suggestion.target_sense_id AS "targetSenseId",
    suggestion.source_artifact AS "sourceArtifact",
    suggestion.target_artifact AS "targetArtifact",
    suggestion.source_content_hash AS "sourceContentHash",
    suggestion.target_content_hash AS "targetContentHash",
    suggestion.relation_type AS "relationType",
    suggestion.direction,
    suggestion.confidence_band AS "confidenceBand",
    suggestion.reason,
    suggestion.evidence,
    suggestion.retrieval_similarity AS "retrievalSimilarity",
    suggestion.mutual_knn AS "mutualKnn",
    suggestion.accepted_relation_id AS "acceptedRelationId",
    suggestion.created_at AS "createdAt",
    suggestion.updated_at AS "updatedAt",
    suggestion.accepted_at AS "acceptedAt",
    suggestion.dismissed_at AS "dismissedAt",
    suggestion.superseded_at AS "supersededAt"
  FROM kg_relation_suggestions suggestion
`;

async function assertOwnedRun(
  sql: SuggestionSql,
  userId: string,
  runId: string,
): Promise<void> {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM kg_runs
    WHERE id = ${runId}
      AND user_id = ${userId}
  `;
  if (!rows[0]) throw new NotFoundError('Knowledge graph run');
}

async function listSuggestions(
  sql: SuggestionSql,
  userId: string,
  runId: string,
  status: SuggestionListStatus,
  cursor: SuggestionCursor | null,
  limit: number,
): Promise<SuggestionListRow[]> {
  await assertOwnedRun(sql, userId, runId);
  const rows =
    cursor === null
      ? await sql.unsafe<SuggestionDatabaseRow[]>(
          `${suggestionSelect}
           WHERE suggestion.run_id = $1
             AND suggestion.user_id = $2
             AND suggestion.status = $3
             AND suggestion.decision = 'relation'
           ORDER BY suggestion.created_at DESC, suggestion.id DESC
           LIMIT $4`,
          [runId, userId, status, limit],
        )
      : await sql.unsafe<SuggestionDatabaseRow[]>(
          `${suggestionSelect}
           WHERE suggestion.run_id = $1
             AND suggestion.user_id = $2
             AND suggestion.status = $3
             AND suggestion.decision = 'relation'
             AND (
               suggestion.created_at < $4
               OR (
                 suggestion.created_at = $4
                 AND suggestion.id < $5
               )
             )
           ORDER BY suggestion.created_at DESC, suggestion.id DESC
           LIMIT $6`,
          [runId, userId, status, cursor.createdAt, cursor.id, limit],
        );
  return rows.map(toSuggestionListRow);
}

async function lockSuggestion(
  sql: SuggestionSql,
  userId: string,
  suggestionId: string,
): Promise<SuggestionDatabaseRow> {
  const rows = await sql.unsafe<SuggestionDatabaseRow[]>(
    `${suggestionSelect}
     WHERE suggestion.id = $1
       AND suggestion.user_id = $2
       AND EXISTS (
         SELECT 1
         FROM kg_runs run
         WHERE run.id = suggestion.run_id
           AND run.user_id = $2
       )
     FOR UPDATE OF suggestion`,
    [suggestionId, userId],
  );
  const suggestion = rows[0];
  if (!suggestion) throw new NotFoundError('Knowledge graph suggestion');
  return suggestion;
}

async function assertOwnedSense(
  sql: SuggestionSql,
  userId: string,
  senseId: string | null,
): Promise<void> {
  if (senseId === null) return;
  const rows = await sql<{ id: string }[]>`
    SELECT sense.id
    FROM lexical_senses sense
    JOIN lexemes lexeme ON lexeme.id = sense.lexeme_id
    WHERE sense.id = ${senseId}
      AND lexeme.user_id = ${userId}
    FOR SHARE OF sense, lexeme
  `;
  if (!rows[0]) throw new NotFoundError('Lexical sense');
}

async function currentCardArtifact(
  sql: SuggestionSql,
  userId: string,
  cardId: string,
  priorArtifact: VocabularyArtifact,
): Promise<VocabularyArtifact> {
  const cards = await sql<{ id: string; templateId: string }[]>`
    SELECT
      card.id,
      deck.card_template_id AS "templateId"
    FROM cards card
    JOIN decks deck ON deck.id = card.deck_id
    WHERE card.id = ${cardId}
      AND deck.user_id = ${userId}
    FOR UPDATE OF card
  `;
  const card = cards[0];
  if (!card) throw new NotFoundError('Card');
  const templateFields = await sql<TemplateFieldRow[]>`
    SELECT id, name
    FROM template_fields
    WHERE template_id = ${card.templateId}
    ORDER BY id
    FOR SHARE
  `;
  const fieldValues = await sql<FieldValueRow[]>`
    SELECT
      template_field_id AS "templateFieldId",
      value
    FROM card_field_values
    WHERE card_id = ${cardId}
    ORDER BY template_field_id
    FOR UPDATE
  `;
  return buildVocabularyArtifact({
    cardId,
    sourceLanguageTag: priorArtifact.sourceLanguageTag,
    definitionLanguageTag: priorArtifact.definitionLanguageTag,
    templateFields,
    fieldValues,
  });
}

async function currentCardArtifactOrStale(
  sql: SuggestionSql,
  userId: string,
  cardId: string,
  priorArtifact: VocabularyArtifact,
): Promise<VocabularyArtifact | 'stale'> {
  try {
    return await currentCardArtifact(sql, userId, cardId, priorArtifact);
  } catch (error) {
    if (error instanceof ValidationError) return 'stale';
    throw error;
  }
}

async function upsertArtifactSense(
  sql: SuggestionSql,
  userId: string,
  artifact: VocabularyArtifact,
  expectedSenseId: string | null,
): Promise<string> {
  const lexemes = await sql<{ id: string }[]>`
    INSERT INTO lexemes (
      user_id,
      language_tag,
      lemma,
      normalized_lemma
    )
    VALUES (
      ${userId},
      ${artifact.sourceLanguageTag},
      ${artifact.lemma},
      ${artifact.normalizedLemma}
    )
    ON CONFLICT (user_id, language_tag, normalized_lemma)
    DO UPDATE SET updated_at = lexemes.updated_at
    RETURNING id
  `;
  const lexemeId = lexemes[0]?.id;
  if (!lexemeId) throw new Error('Lexeme upsert returned no identity');
  const senses = await sql<{ id: string }[]>`
    INSERT INTO lexical_senses (
      lexeme_id,
      part_of_speech,
      definition_language_tag,
      definition,
      normalized_definition,
      ipa,
      examples
    )
    VALUES (
      ${lexemeId},
      ${artifact.partOfSpeech},
      ${artifact.definitionLanguageTag},
      ${artifact.definition},
      ${artifact.normalizedDefinition},
      ${artifact.ipa},
      ${sql.json(artifact.examples)}
    )
    ON CONFLICT (
      lexeme_id,
      part_of_speech,
      definition_language_tag,
      normalized_definition
    )
    DO UPDATE SET
      ipa = CASE
        WHEN lexical_senses.ipa IS NULL AND EXCLUDED.ipa IS NOT NULL
          THEN EXCLUDED.ipa
        ELSE lexical_senses.ipa
      END,
      examples = CASE
        WHEN lexical_senses.examples = '[]'::jsonb
          AND EXCLUDED.examples <> '[]'::jsonb
          THEN EXCLUDED.examples
        ELSE lexical_senses.examples
      END
    RETURNING id
  `;
  const senseId = senses[0]?.id;
  if (!senseId) throw new Error('Lexical sense upsert returned no identity');
  if (expectedSenseId !== null && expectedSenseId !== senseId) {
    throw new ConflictError(
      'Suggestion no longer matches its indexed lexical sense',
    );
  }
  return senseId;
}

async function upsertCardSense(
  sql: SuggestionSql,
  cardId: string | null,
  senseId: string,
): Promise<void> {
  if (cardId === null) return;
  await sql`
    INSERT INTO card_senses (
      card_id,
      sense_id,
      source,
      is_primary
    )
    VALUES (${cardId}, ${senseId}, 'ai', false)
    ON CONFLICT (card_id, sense_id)
    DO UPDATE SET updated_at = card_senses.updated_at
  `;
}

function orientRelation(
  relationType: RelationType,
  direction: RelationDirection,
  sourceSenseId: string,
  targetSenseId: string,
): [string, string] {
  if (sourceSenseId === targetSenseId) {
    throw new ValidationError('A lexical sense cannot relate to itself');
  }
  if (symmetricRelationTypes.has(relationType)) {
    if (direction !== 'symmetric') return invalidSuggestionProvenance();
    return sourceSenseId < targetSenseId
      ? [sourceSenseId, targetSenseId]
      : [targetSenseId, sourceSenseId];
  }
  if (direction === 'source_to_target') {
    return [sourceSenseId, targetSenseId];
  }
  if (direction === 'target_to_source') {
    return [targetSenseId, sourceSenseId];
  }
  return invalidSuggestionProvenance();
}

async function upsertRelation(
  sql: SuggestionSql,
  userId: string,
  suggestion: SuggestionListRow,
  sourceSenseId: string,
  targetSenseId: string,
): Promise<string> {
  const [orientedSourceId, orientedTargetId] = orientRelation(
    suggestion.relationType,
    suggestion.direction,
    sourceSenseId,
    targetSenseId,
  );
  const rows = await sql<{ id: string }[]>`
    INSERT INTO sense_relations (
      user_id,
      source_sense_id,
      target_sense_id,
      relation_type,
      origin,
      confidence,
      evidence
    )
    VALUES (
      ${userId},
      ${orientedSourceId},
      ${orientedTargetId},
      ${suggestion.relationType},
      'ai',
      ${confidenceScoreForBand(suggestion.confidenceBand)},
      ${suggestion.evidence === null ? null : sql.json(suggestion.evidence)}
    )
    ON CONFLICT (
      user_id,
      source_sense_id,
      target_sense_id,
      relation_type
    )
    DO UPDATE SET
      origin = CASE
        WHEN sense_relations.origin = 'manual' THEN 'manual'
        ELSE sense_relations.origin
      END,
      confidence = greatest(sense_relations.confidence, EXCLUDED.confidence),
      evidence = coalesce(sense_relations.evidence, EXCLUDED.evidence),
      updated_at = now()
    RETURNING id
  `;
  const relationId = rows[0]?.id;
  if (!relationId) throw new Error('Sense relation upsert returned no identity');
  return relationId;
}

async function mappedCardForSense(
  sql: SuggestionSql,
  userId: string,
  senseId: string,
  preferredCardId: string | null,
): Promise<string | null> {
  const rows = await sql<{ cardId: string }[]>`
    SELECT mapping.card_id AS "cardId"
    FROM card_senses mapping
    JOIN cards card ON card.id = mapping.card_id
    JOIN decks deck ON deck.id = card.deck_id
    WHERE mapping.sense_id = ${senseId}
      AND deck.user_id = ${userId}
    ORDER BY
      (
        ${preferredCardId}::uuid IS NOT NULL
        AND mapping.card_id = ${preferredCardId}::uuid
      ) DESC,
      mapping.is_primary DESC,
      mapping.card_id
    LIMIT 1
  `;
  return rows[0]?.cardId ?? null;
}

async function projectLegacyLink(
  sql: SuggestionSql,
  userId: string,
  suggestion: SuggestionListRow,
  sourceSenseId: string,
  targetSenseId: string,
): Promise<void> {
  const sourceCardId = await mappedCardForSense(
    sql,
    userId,
    sourceSenseId,
    suggestion.sourceCardId,
  );
  const targetCardId = await mappedCardForSense(
    sql,
    userId,
    targetSenseId,
    suggestion.targetCardId,
  );
  if (
    sourceCardId === null ||
    targetCardId === null ||
    sourceCardId === targetCardId
  ) {
    return;
  }
  const [canonicalSourceId, canonicalTargetId] =
    sourceCardId < targetCardId
      ? [sourceCardId, targetCardId]
      : [targetCardId, sourceCardId];
  await sql`
    INSERT INTO card_links (
      source_card_id,
      target_card_id,
      link_type
    )
    VALUES (${canonicalSourceId}, ${canonicalTargetId}, 'related')
    ON CONFLICT (source_card_id, target_card_id, link_type)
    DO NOTHING
  `;
}

async function acceptSuggestion(
  sql: SuggestionSql,
  userId: string,
  suggestionId: string,
): Promise<SuggestionAcceptResult> {
  return sql.begin(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as SuggestionSql;
    const locked = await lockSuggestion(
      transaction,
      userId,
      suggestionId,
    );
    if (locked.status === 'accepted') {
      if (locked.acceptedRelationId === null) {
        throw new ConflictError('Accepted suggestion relation no longer exists');
      }
      return {
        outcome: 'accepted' as const,
        suggestion: toSuggestionListRow(locked),
        relationId: locked.acceptedRelationId,
      };
    }
    if (locked.status !== 'pending') {
      throw new ConflictError('Suggestion is no longer pending');
    }
    const suggestion = toSuggestionListRow(locked);
    const ownedSenseIds = [
      suggestion.sourceSenseId,
      suggestion.targetSenseId,
    ]
      .filter((senseId): senseId is string => senseId !== null)
      .filter((senseId, index, values) => values.indexOf(senseId) === index)
      .sort();
    for (const senseId of ownedSenseIds) {
      await assertOwnedSense(transaction, userId, senseId);
    }

    type EndpointName = 'source' | 'target';
    type CurrentCardState = VocabularyArtifact | 'stale' | null;
    const currentByEndpoint = new Map<EndpointName, CurrentCardState>([
      ['source', null],
      ['target', null],
    ]);
    const cardEndpoints = [
      {
        endpoint: 'source' as const,
        cardId: suggestion.sourceCardId,
        artifact: suggestion.sourceArtifact,
      },
      {
        endpoint: 'target' as const,
        cardId: suggestion.targetCardId,
        artifact: suggestion.targetArtifact,
      },
    ]
      .filter(
        (
          endpoint,
        ): endpoint is typeof endpoint & { cardId: string } =>
          endpoint.cardId !== null,
      )
      .sort(
        (left, right) =>
          left.cardId.localeCompare(right.cardId) ||
          left.endpoint.localeCompare(right.endpoint),
      );
    for (const endpoint of cardEndpoints) {
      currentByEndpoint.set(
        endpoint.endpoint,
        await currentCardArtifactOrStale(
          transaction,
          userId,
          endpoint.cardId,
          endpoint.artifact,
        ),
      );
    }
    const currentSource = currentByEndpoint.get('source') ?? null;
    const currentTarget = currentByEndpoint.get('target') ?? null;
    if (
      currentSource === 'stale' ||
      currentTarget === 'stale' ||
      (currentSource !== null &&
        currentSource.contentHash !== locked.sourceContentHash) ||
      (currentTarget !== null &&
        currentTarget.contentHash !== locked.targetContentHash)
    ) {
      await transaction`
        UPDATE kg_relation_suggestions
        SET
          status = 'superseded',
          superseded_at = now(),
          updated_at = now()
        WHERE id = ${suggestionId}
          AND user_id = ${userId}
          AND status = 'pending'
      `;
      return { outcome: 'superseded' as const };
    }

    const senseByEndpoint = new Map<EndpointName, string>();
    const lexicalEndpoints = [
      {
        endpoint: 'source' as const,
        artifact: suggestion.sourceArtifact,
        expectedSenseId: suggestion.sourceSenseId,
      },
      {
        endpoint: 'target' as const,
        artifact: suggestion.targetArtifact,
        expectedSenseId: suggestion.targetSenseId,
      },
    ].sort((left, right) => {
      const leftKey = [
        left.artifact.sourceLanguageTag,
        left.artifact.normalizedLemma,
        left.artifact.partOfSpeech,
        left.artifact.definitionLanguageTag,
        left.artifact.normalizedDefinition,
      ].join('\u0000');
      const rightKey = [
        right.artifact.sourceLanguageTag,
        right.artifact.normalizedLemma,
        right.artifact.partOfSpeech,
        right.artifact.definitionLanguageTag,
        right.artifact.normalizedDefinition,
      ].join('\u0000');
      return (
        leftKey.localeCompare(rightKey) ||
        left.endpoint.localeCompare(right.endpoint)
      );
    });
    for (const endpoint of lexicalEndpoints) {
      senseByEndpoint.set(
        endpoint.endpoint,
        await upsertArtifactSense(
          transaction,
          userId,
          endpoint.artifact,
          endpoint.expectedSenseId,
        ),
      );
    }
    const sourceSenseId = senseByEndpoint.get('source');
    const targetSenseId = senseByEndpoint.get('target');
    if (!sourceSenseId || !targetSenseId) {
      throw new Error('Suggestion sense upsert returned no endpoint identity');
    }
    const cardMappings = [
      { cardId: suggestion.sourceCardId, senseId: sourceSenseId },
      { cardId: suggestion.targetCardId, senseId: targetSenseId },
    ].sort(
      (left, right) =>
        (left.cardId ?? '').localeCompare(right.cardId ?? '') ||
        left.senseId.localeCompare(right.senseId),
    );
    for (const mapping of cardMappings) {
      await upsertCardSense(
        transaction,
        mapping.cardId,
        mapping.senseId,
      );
    }
    const relationId = await upsertRelation(
      transaction,
      userId,
      suggestion,
      sourceSenseId,
      targetSenseId,
    );
    await projectLegacyLink(
      transaction,
      userId,
      suggestion,
      sourceSenseId,
      targetSenseId,
    );
    const accepted = await transaction<SuggestionDatabaseRow[]>`
      UPDATE kg_relation_suggestions
      SET
        status = 'accepted',
        source_sense_id = ${sourceSenseId},
        target_sense_id = ${targetSenseId},
        accepted_relation_id = ${relationId},
        accepted_at = now(),
        updated_at = now()
      WHERE id = ${suggestionId}
        AND user_id = ${userId}
        AND status = 'pending'
      RETURNING
        id,
        run_id AS "runId",
        user_id AS "userId",
        status,
        decision,
        source_card_id AS "sourceCardId",
        target_card_id AS "targetCardId",
        source_sense_id AS "sourceSenseId",
        target_sense_id AS "targetSenseId",
        source_artifact AS "sourceArtifact",
        target_artifact AS "targetArtifact",
        source_content_hash AS "sourceContentHash",
        target_content_hash AS "targetContentHash",
        relation_type AS "relationType",
        direction,
        confidence_band AS "confidenceBand",
        reason,
        evidence,
        retrieval_similarity AS "retrievalSimilarity",
        mutual_knn AS "mutualKnn",
        accepted_relation_id AS "acceptedRelationId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        accepted_at AS "acceptedAt",
        dismissed_at AS "dismissedAt",
        superseded_at AS "supersededAt"
    `;
    const acceptedSuggestion = accepted[0];
    if (!acceptedSuggestion) {
      throw new ConflictError('Suggestion is no longer pending');
    }
    return {
      outcome: 'accepted' as const,
      suggestion: toSuggestionListRow(acceptedSuggestion),
      relationId,
    };
  });
}

async function dismissSuggestion(
  sql: SuggestionSql,
  userId: string,
  suggestionId: string,
): Promise<SuggestionDismissResult> {
  return sql.begin(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as SuggestionSql;
    const suggestion = await lockSuggestion(
      transaction,
      userId,
      suggestionId,
    );
    const parsedSuggestion = toSuggestionListRow(suggestion);
    if (suggestion.status === 'dismissed') {
      if (suggestion.dismissedAt === null) {
        return invalidSuggestionProvenance();
      }
      return {
        id: suggestion.id,
        runId: parsedSuggestion.runId,
        relationType: parsedSuggestion.relationType,
        confidenceBand: parsedSuggestion.confidenceBand,
        status: 'dismissed' as const,
        dismissedAt: suggestion.dismissedAt,
      };
    }
    if (suggestion.status !== 'pending') {
      throw new ConflictError('Suggestion is no longer pending');
    }
    const rows = await transaction<{
      id: string;
      dismissedAt: Date;
    }[]>`
      UPDATE kg_relation_suggestions
      SET
        status = 'dismissed',
        dismissed_at = now(),
        updated_at = now()
      WHERE id = ${suggestionId}
        AND user_id = ${userId}
        AND status = 'pending'
      RETURNING id, dismissed_at AS "dismissedAt"
    `;
    const dismissed = rows[0];
    if (!dismissed) {
      throw new ConflictError('Suggestion is no longer pending');
    }
    return {
      id: dismissed.id,
      runId: parsedSuggestion.runId,
      relationType: parsedSuggestion.relationType,
      confidenceBand: parsedSuggestion.confidenceBand,
      status: 'dismissed' as const,
      dismissedAt: dismissed.dismissedAt,
    };
  });
}

export function createPostgresSuggestionReviewRepository(
  sql: Sql = pgClient,
): SuggestionReviewRepository {
  return {
    list: (userId, runId, status, cursor, limit) =>
      listSuggestions(sql, userId, runId, status, cursor, limit),
    accept: (userId, suggestionId) =>
      acceptSuggestion(sql, userId, suggestionId),
    dismiss: (userId, suggestionId) =>
      dismissSuggestion(sql, userId, suggestionId),
  };
}

let defaultRepository: SuggestionReviewRepository | null = null;

export function getPostgresSuggestionReviewRepository(): SuggestionReviewRepository {
  defaultRepository ??= createPostgresSuggestionReviewRepository();
  return defaultRepository;
}
