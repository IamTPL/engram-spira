import { sql, type SQL } from 'drizzle-orm';

import type { db as database } from '../../db';
import { NotFoundError } from '../../shared/errors';
import type {
  CandidateEndpoint,
  CandidateRepository,
  CandidateStageInput,
  CanonicalCandidate,
  DirectedCandidateRow,
} from './kg-candidates';

const SYMMETRIC_RELATION_TYPES = sql`
  ('synonym', 'antonym', 'collocation', 'confused_with',
   'translation_of', 'coordinate')
`;
const DIRECTED_RELATION_TYPES = sql`
  ('is_a', 'part_of', 'derived_from')
`;

export type CandidateSqlExecutor = Pick<typeof database, 'execute'>;

type CandidateKnnRow = {
  runId: string;
  cardCount: number | string;
  fallbackSourceCount: number | string;
  sourceCardId: string | null;
  sourceSenseId: string | null;
  sourceArtifact: CandidateEndpoint['artifact'] | null;
  targetCardId: string | null;
  targetSenseId: string | null;
  targetArtifact: CandidateEndpoint['artifact'] | null;
  similarity: number | string | null;
  acceptedRelation: boolean | null;
};

export type CandidateKnnQueryOptions = {
  hnswIterativeScan?: 'strict_order' | 'off';
  hnswMaxScanTuples?: number;
  hnswEfSearch?: number;
};

type SuppressionRow = {
  fingerprint: string;
  dismissed: boolean;
  duplicateSuggestion: boolean;
  currentNegative: boolean;
};

function candidatesJson(candidates: CanonicalCandidate[]): string {
  return JSON.stringify(
    candidates.map((candidate) => ({
      fingerprint: candidate.fingerprint,
      sourceCardId: candidate.source.cardId,
      targetCardId: candidate.target.cardId,
      sourceContentHash: candidate.source.artifact.contentHash,
      targetContentHash: candidate.target.artifact.contentHash,
    })),
  );
}

export function buildCandidateKnnQuery(
  input: CandidateStageInput,
  options: CandidateKnnQueryOptions = {},
): SQL {
  const hnswIterativeScan =
    options.hnswIterativeScan === 'off' ? 'off' : 'strict_order';
  const hnswMaxScanTuples =
    Number.isInteger(options.hnswMaxScanTuples) &&
    (options.hnswMaxScanTuples ?? 0) > 0
      ? options.hnswMaxScanTuples!
      : 100_000;
  const hnswEfSearch =
    Number.isInteger(options.hnswEfSearch) &&
    (options.hnswEfSearch ?? 0) > 0
      ? options.hnswEfSearch!
      : 100;
  return sql`
    WITH run_context AS MATERIALIZED (
      SELECT
        run.id,
        run.user_id,
        run.deck_id,
        run.embedding_model,
        run.representation_version,
        run.prompt_version,
        run.taxonomy_version,
        run.source_language_tag,
        run.definition_language_tag,
        run.snapshot,
        jsonb_array_length(COALESCE(run.snapshot -> 'cards', '[]'::jsonb))
          AS card_count
      FROM kg_runs AS run
      JOIN decks AS deck
        ON deck.id = run.deck_id
       AND deck.user_id = run.user_id
      WHERE run.id = ${input.runId}::uuid
        AND run.user_id = ${input.userId}::uuid
        AND run.deck_id = ${input.deckId}::uuid
        AND run.run_type = 'deck_index'
        AND run.embedding_model = ${input.embeddingModel}
        AND run.representation_version = ${input.representationVersion}
        AND run.prompt_version = ${input.promptVersion}
        AND run.taxonomy_version = ${input.taxonomyVersion}
    ),
    snapshot_cards AS MATERIALIZED (
      SELECT
        snapshot_card."cardId"::uuid AS card_id,
        snapshot_card."contentHash" AS content_hash
      FROM run_context AS run
      CROSS JOIN LATERAL jsonb_to_recordset(
        COALESCE(run.snapshot -> 'cards', '[]'::jsonb)
      ) AS snapshot_card(
        "cardId" text,
        "contentHash" text
      )
    ),
    hnsw_settings AS MATERIALIZED (
      SELECT
        set_config(
          'hnsw.iterative_scan',
          ${hnswIterativeScan},
          true
        )
        || ':' ||
        set_config(
          'hnsw.max_scan_tuples',
          ${String(hnswMaxScanTuples)},
          true
        )
        || ':' ||
        set_config(
          'hnsw.ef_search',
          ${String(hnswEfSearch)},
          true
        ) AS search_settings
    ),
    eligible_cards AS MATERIALIZED (
      SELECT DISTINCT ON (card.id)
        card.id AS card_id,
        mapping.sense_id,
        field_value.embedding,
        jsonb_build_object(
          'cardId', card.id,
          'sourceLanguageTag', lexeme.language_tag,
          'definitionLanguageTag', sense.definition_language_tag,
          'lemma', lexeme.lemma,
          'normalizedLemma', lexeme.normalized_lemma,
          'partOfSpeech', sense.part_of_speech,
          'definition', sense.definition,
          'normalizedDefinition', sense.normalized_definition,
          'ipa', sense.ipa,
          'examples', sense.examples,
          'contentHash', snapshot_card.content_hash,
          'representationVersion', run.representation_version
        ) AS artifact
      FROM run_context AS run
      JOIN snapshot_cards AS snapshot_card ON true
      JOIN cards AS card
        ON card.id = snapshot_card.card_id
       AND card.deck_id = run.deck_id
      JOIN card_senses AS mapping
        ON mapping.card_id = card.id
       AND mapping.is_primary = true
      JOIN lexical_senses AS sense ON sense.id = mapping.sense_id
      JOIN lexemes AS lexeme
        ON lexeme.id = sense.lexeme_id
       AND lexeme.user_id = run.user_id
       AND lexeme.language_tag = run.source_language_tag
      JOIN card_embedding_metadata AS metadata
        ON metadata.card_id = card.id
       AND metadata.model = run.embedding_model
       AND metadata.dimensions = 768
       AND metadata.representation_version = run.representation_version
       AND metadata.content_hash = snapshot_card.content_hash
      JOIN card_field_values AS field_value
        ON field_value.card_id = card.id
       AND field_value.embedding IS NOT NULL
      WHERE sense.definition_language_tag = run.definition_language_tag
      ORDER BY card.id, field_value.id
    ),
    fast_neighbors AS (
      SELECT
        source.card_id AS source_card_id,
        neighbor.card_id AS target_card_id,
        neighbor.distance
      FROM eligible_cards AS source
      CROSS JOIN LATERAL (
        SELECT
          target_vector.card_id,
          target_vector.embedding <=> source.embedding AS distance
        FROM card_field_values AS target_vector
          WHERE (
            SELECT settings.search_settings
            FROM hnsw_settings AS settings
          ) = ${`${hnswIterativeScan}:${hnswMaxScanTuples}:${hnswEfSearch}`}
          AND target_vector.embedding IS NOT NULL
          AND target_vector.card_id <> source.card_id
          AND NOT EXISTS (
            SELECT 1
            FROM card_field_values AS duplicate_vector
            WHERE duplicate_vector.card_id = target_vector.card_id
              AND duplicate_vector.embedding IS NOT NULL
              AND duplicate_vector.id < target_vector.id
          )
          AND EXISTS (
            SELECT 1
            FROM eligible_cards AS eligible_target
            WHERE eligible_target.card_id = target_vector.card_id
              AND eligible_target.sense_id <> source.sense_id
          )
        ORDER BY target_vector.embedding <=> source.embedding
        LIMIT 8
      ) AS neighbor
      WHERE neighbor.distance >= 0
        AND neighbor.distance <= 2
    ),
    eligible_target_counts AS MATERIALIZED (
      SELECT
        source.card_id AS source_card_id,
        count(target.card_id)::integer AS target_count
      FROM eligible_cards AS source
      LEFT JOIN eligible_cards AS target
        ON target.card_id <> source.card_id
       AND target.sense_id <> source.sense_id
      GROUP BY source.card_id
    ),
    underfilled_sources AS MATERIALIZED (
      SELECT source.*
      FROM eligible_cards AS source
      JOIN eligible_target_counts AS target_count
        ON target_count.source_card_id = source.card_id
      WHERE (
        SELECT count(*)
        FROM fast_neighbors AS fast
        WHERE fast.source_card_id = source.card_id
      ) < LEAST(8, target_count.target_count)
    ),
    fallback_neighbors AS (
      SELECT
        source.card_id AS source_card_id,
        neighbor.card_id AS target_card_id,
        neighbor.distance
      FROM underfilled_sources AS source
      CROSS JOIN LATERAL (
        SELECT scored.card_id, scored.distance
        FROM (
          SELECT
            target.card_id,
            target.embedding <=> source.embedding AS distance
          FROM eligible_cards AS target
          WHERE target.card_id <> source.card_id
            AND target.sense_id <> source.sense_id
        ) AS scored
        WHERE scored.distance >= 0
          AND scored.distance <= 2
        ORDER BY scored.distance, scored.card_id
        LIMIT 8
      ) AS neighbor
    ),
    neighbors AS (
      SELECT
        fast.source_card_id,
        fast.target_card_id,
        fast.distance
      FROM fast_neighbors AS fast
      WHERE NOT EXISTS (
        SELECT 1
        FROM underfilled_sources AS underfilled
        WHERE underfilled.card_id = fast.source_card_id
      )
      UNION ALL
      SELECT source_card_id, target_card_id, distance
      FROM fallback_neighbors
    ),
    deduplicated_neighbors AS (
      SELECT
        source_card_id,
        target_card_id,
        min(distance) AS distance
      FROM neighbors
      GROUP BY source_card_id, target_card_id
    ),
    directed_candidates AS (
      SELECT
        source.card_id AS source_card_id,
        source.sense_id AS source_sense_id,
        source.artifact AS source_artifact,
        target.card_id AS target_card_id,
        target.sense_id AS target_sense_id,
        target.artifact AS target_artifact,
        GREATEST(
          0::double precision,
          LEAST(1::double precision, 1 - neighbor.distance)
        ) AS similarity,
        EXISTS (
          SELECT 1
          FROM sense_relations AS relation
          JOIN run_context AS relation_run
            ON relation_run.user_id = relation.user_id
          WHERE (
            relation.relation_type IN ${SYMMETRIC_RELATION_TYPES}
            AND (
              (
                relation.source_sense_id = source.sense_id
                AND relation.target_sense_id = target.sense_id
              )
              OR (
                relation.source_sense_id = target.sense_id
                AND relation.target_sense_id = source.sense_id
              )
            )
          ) OR (
            relation.relation_type IN ${DIRECTED_RELATION_TYPES}
            AND relation.source_sense_id = source.sense_id
            AND relation.target_sense_id = target.sense_id
          )
        ) AS accepted_relation
      FROM deduplicated_neighbors AS neighbor
      JOIN eligible_cards AS source
        ON source.card_id = neighbor.source_card_id
      JOIN eligible_cards AS target
        ON target.card_id = neighbor.target_card_id
    )
    SELECT
      run.id AS "runId",
      run.card_count AS "cardCount",
      (SELECT count(*) FROM underfilled_sources) AS "fallbackSourceCount",
      candidate.source_card_id AS "sourceCardId",
      candidate.source_sense_id AS "sourceSenseId",
      candidate.source_artifact AS "sourceArtifact",
      candidate.target_card_id AS "targetCardId",
      candidate.target_sense_id AS "targetSenseId",
      candidate.target_artifact AS "targetArtifact",
      candidate.similarity AS "similarity",
      candidate.accepted_relation AS "acceptedRelation"
    FROM run_context AS run
    LEFT JOIN directed_candidates AS candidate ON true
    ORDER BY
      candidate.source_card_id,
      candidate.target_card_id,
      candidate.similarity DESC
  `;
}

function buildCandidateSuppressionQuery(
  input: CandidateStageInput,
  candidates: CanonicalCandidate[],
): SQL {
  return sql`
    WITH candidate AS (
      SELECT *
      FROM jsonb_to_recordset(${candidatesJson(candidates)}::jsonb) AS input(
        "fingerprint" text,
        "sourceCardId" uuid,
        "targetCardId" uuid,
        "sourceContentHash" text,
        "targetContentHash" text
      )
    )
    SELECT
      candidate."fingerprint" AS fingerprint,
      (
        EXISTS (
          SELECT 1
          FROM dismissed_suggestions AS dismissal
          WHERE dismissal.user_id = ${input.userId}::uuid
            AND dismissal.source_card_id = candidate."sourceCardId"
            AND dismissal.target_card_id = candidate."targetCardId"
        )
        OR EXISTS (
          SELECT 1
          FROM kg_relation_suggestions AS suggestion
          WHERE suggestion.user_id = ${input.userId}::uuid
            AND suggestion.fingerprint = candidate."fingerprint"
            AND suggestion.status = 'dismissed'
        )
      ) AS dismissed,
      EXISTS (
        SELECT 1
        FROM kg_relation_suggestions AS suggestion
        WHERE suggestion.user_id = ${input.userId}::uuid
          AND suggestion.fingerprint = candidate."fingerprint"
          AND suggestion.status IN ('pending', 'accepted')
      ) AS "duplicateSuggestion",
      EXISTS (
        SELECT 1
        FROM kg_relation_suggestions AS suggestion
        JOIN kg_runs AS prior_run ON prior_run.id = suggestion.run_id
        WHERE suggestion.user_id = ${input.userId}::uuid
          AND suggestion.fingerprint = candidate."fingerprint"
          AND suggestion.decision = 'none'
          AND suggestion.status = 'rejected'
          AND suggestion.source_content_hash =
            candidate."sourceContentHash"
          AND suggestion.target_content_hash =
            candidate."targetContentHash"
          AND prior_run.embedding_model = ${input.embeddingModel}
          AND prior_run.representation_version =
            ${input.representationVersion}
          AND prior_run.prompt_version = ${input.promptVersion}
          AND prior_run.taxonomy_version = ${input.taxonomyVersion}
      ) AS "currentNegative"
    FROM candidate
  `;
}

function mapDirectedRows(rows: CandidateKnnRow[]): DirectedCandidateRow[] {
  const bestRows = new Map<string, DirectedCandidateRow>();
  for (const row of rows) {
    if (
      !row.sourceCardId ||
      !row.sourceSenseId ||
      !row.sourceArtifact ||
      !row.targetCardId ||
      !row.targetSenseId ||
      !row.targetArtifact ||
      row.similarity === null
    ) {
      continue;
    }
    const candidate: DirectedCandidateRow = {
      source: {
        cardId: row.sourceCardId,
        senseId: row.sourceSenseId,
        artifact: row.sourceArtifact,
      },
      target: {
        cardId: row.targetCardId,
        senseId: row.targetSenseId,
        artifact: row.targetArtifact,
      },
      similarity: Number(row.similarity),
      compatible: true,
      acceptedRelation: row.acceptedRelation === true,
    };
    const key = [
      candidate.source.cardId,
      candidate.source.senseId,
      candidate.target.cardId,
      candidate.target.senseId,
    ].join(':');
    const existing = bestRows.get(key);
    if (!existing || candidate.similarity > existing.similarity) {
      bestRows.set(key, candidate);
    }
  }
  return [...bestRows.values()];
}

export function createPostgresCandidateRepository(
  executor: CandidateSqlExecutor,
): CandidateRepository {
  return {
    async retrieveDirectedCandidates(input) {
      const rows = await executor.execute<CandidateKnnRow>(
        buildCandidateKnnQuery(input),
      );
      const context = rows[0];
      if (!context) throw new NotFoundError('Run');
      return {
        cardCount: Number(context.cardCount),
        fallbackSourceCount: Number(context.fallbackSourceCount),
        rows: mapDirectedRows(rows),
      };
    },

    async loadSuppressedFingerprints(input, candidates) {
      if (candidates.length === 0) return new Set();
      const rows = await executor.execute<SuppressionRow>(
        buildCandidateSuppressionQuery(input, candidates),
      );
      return new Set(
        rows
          .filter(
            (row) =>
              row.dismissed ||
              row.duplicateSuggestion ||
              row.currentNegative,
          )
          .map((row) => row.fingerprint),
      );
    },
  };
}
