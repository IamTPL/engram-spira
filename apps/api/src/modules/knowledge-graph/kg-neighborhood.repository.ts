import type { Sql } from 'postgres';

import { pgClient } from '../../db';
import type {
  CardNeighborhoodRepository,
  CardSenseMapping,
  MapCardSenseResult,
  NeighborhoodNodeRecord,
  NeighborhoodPageInput,
  NeighborhoodPageRecord,
  NeighborhoodSummary,
  RelationGroup,
} from './kg-neighborhood.service';
import type { RelationType } from './kg-verifier';
import { confidenceBandForScore } from './kg-confidence';

type FocusIdentityRow = {
  cardId: string;
  deckId: string;
  senseId: string | null;
};

type NodeRow = {
  id: string;
  lexemeId: string;
  label: string;
  normalizedLemma: string;
  languageTag: string;
  partOfSpeech: string;
  definition: string;
  mappedCardIds: string[];
  inCurrentDeck: boolean;
  retention: number | null;
  dueAt: Date | null;
};

type NeighborIdentityRow = {
  senseId: string;
};

type EdgeRow = {
  id: string;
  sourceSenseId: string;
  targetSenseId: string;
  relationType: RelationType;
  origin: 'manual' | 'ai';
  confidence: number | string;
  evidence: unknown;
};

type SummaryRow = {
  deckCards: number;
  connectedCards: number;
  hierarchyCount: number;
  meaningCount: number;
  formCount: number;
  usageCount: number;
};

type MappingRow = {
  cardId: string;
  senseId: string;
  source: CardSenseMapping['source'];
  isPrimary: boolean;
};

const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

function relationGroup(relationType: RelationType): RelationGroup {
  switch (relationType) {
    case 'is_a':
    case 'part_of':
      return 'hierarchy';
    case 'synonym':
    case 'antonym':
    case 'translation_of':
    case 'coordinate':
      return 'meaning';
    case 'derived_from':
      return 'form';
    case 'collocation':
    case 'confused_with':
      return 'usage';
  }
}

function relationIsDirected(relationType: RelationType): boolean {
  return (
    relationType === 'is_a' ||
    relationType === 'part_of' ||
    relationType === 'derived_from'
  );
}

function formatEvidence(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.source !== 'string' || typeof record.target !== 'string') {
    return null;
  }
  return `${record.source} ↔ ${record.target}`;
}

async function loadNodes(
  sql: Sql,
  input: {
    userId: string;
    deckId: string;
    focusCardId: string;
    senseIds: string[];
  },
): Promise<NeighborhoodNodeRecord[]> {
  if (input.senseIds.length === 0) return [];

  const rows = await sql<NodeRow[]>`
    SELECT
      ls.id,
      l.id AS "lexemeId",
      l.lemma AS label,
      l.normalized_lemma AS "normalizedLemma",
      l.language_tag AS "languageTag",
      ls.part_of_speech AS "partOfSpeech",
      ls.definition,
      COALESCE(mapped.mapped_card_ids, ARRAY[]::text[]) AS "mappedCardIds",
      COALESCE(mapped.in_current_deck, false) AS "inCurrentDeck",
      representative.retention,
      representative.next_review_at AS "dueAt"
    FROM lexical_senses ls
    JOIN lexemes l
      ON l.id = ls.lexeme_id
     AND l.user_id = ${input.userId}
    LEFT JOIN LATERAL (
      SELECT
        ARRAY_AGG(
          c.id::text
          ORDER BY (c.deck_id = ${input.deckId}) DESC, c.id
        ) AS mapped_card_ids,
        BOOL_OR(c.deck_id = ${input.deckId}) AS in_current_deck
      FROM card_senses cs
      JOIN cards c ON c.id = cs.card_id
      JOIN decks d
        ON d.id = c.deck_id
       AND d.user_id = ${input.userId}
      WHERE cs.sense_id = ls.id
    ) mapped ON true
    LEFT JOIN LATERAL (
      SELECT
        sp.next_review_at,
        CASE
          WHEN sp.last_reviewed_at IS NULL THEN NULL
          ELSE LEAST(
            1,
            EXP(
              GREATEST(
                -50,
                -(
                  EXTRACT(EPOCH FROM (NOW() - sp.last_reviewed_at)) / 86400
                ) / GREATEST(
                  COALESCE(
                    sp.stability,
                    sp.interval_days::real * (sp.ease_factor / 2.5),
                    1
                  ),
                  1
                )
              )
            )
          )::real
        END AS retention
      FROM card_senses cs
      JOIN cards c ON c.id = cs.card_id
      JOIN decks d
        ON d.id = c.deck_id
       AND d.user_id = ${input.userId}
      LEFT JOIN study_progress sp
        ON sp.card_id = c.id
       AND sp.user_id = ${input.userId}
      WHERE cs.sense_id = ls.id
      ORDER BY
        (c.id = ${input.focusCardId}) DESC,
        (c.deck_id = ${input.deckId}) DESC,
        (sp.id IS NOT NULL) DESC,
        c.id
      LIMIT 1
    ) representative ON true
    WHERE ls.id IN ${sql(input.senseIds)}
    ORDER BY l.normalized_lemma COLLATE "C", ls.id
  `;

  return rows.map((row) => ({
    id: row.id,
    lexemeId: row.lexemeId,
    label: row.label,
    normalizedLemma: row.normalizedLemma,
    languageTag: row.languageTag,
    partOfSpeech: row.partOfSpeech,
    definition: row.definition,
    mappedCardIds: row.mappedCardIds,
    inCurrentDeck: row.inCurrentDeck,
    retention: row.retention,
    dueAt: row.dueAt,
  }));
}

async function loadFocus(
  sql: Sql,
  userId: string,
  cardId: string,
) {
  const [identity] = await sql<FocusIdentityRow[]>`
    SELECT
      c.id AS "cardId",
      c.deck_id AS "deckId",
      focus_mapping.sense_id AS "senseId"
    FROM cards c
    JOIN decks d
      ON d.id = c.deck_id
     AND d.user_id = ${userId}
    LEFT JOIN LATERAL (
      SELECT cs.sense_id
      FROM card_senses cs
      JOIN lexical_senses ls ON ls.id = cs.sense_id
      JOIN lexemes l
        ON l.id = ls.lexeme_id
       AND l.user_id = ${userId}
      WHERE cs.card_id = c.id
      ORDER BY cs.is_primary DESC, cs.sense_id
      LIMIT 1
    ) focus_mapping ON true
    WHERE c.id = ${cardId}
    LIMIT 1
  `;
  if (!identity) return null;
  if (!identity.senseId) {
    return {
      cardId: identity.cardId,
      deckId: identity.deckId,
      focus: null,
    };
  }

  const [focus] = await loadNodes(sql, {
    userId,
    deckId: identity.deckId,
    focusCardId: cardId,
    senseIds: [identity.senseId],
  });
  return {
    cardId: identity.cardId,
    deckId: identity.deckId,
    focus: focus ?? null,
  };
}

async function loadNeighborIds(
  sql: Sql,
  input: NeighborhoodPageInput,
): Promise<{ senseIds: string[]; hasMore: boolean }> {
  const afterLemma = input.after?.normalizedLemma ?? '';
  const afterSenseId = input.after?.senseId ?? EMPTY_UUID;
  const applyAfter = input.after !== null;
  const rows = await sql<NeighborIdentityRow[]>`
    WITH incident AS (
      SELECT DISTINCT CASE
        WHEN sr.source_sense_id = ${input.focusSenseId}
          THEN sr.target_sense_id
        ELSE sr.source_sense_id
      END AS neighbor_sense_id
      FROM sense_relations sr
      JOIN lexical_senses source_sense
        ON source_sense.id = sr.source_sense_id
      JOIN lexemes source_lexeme
        ON source_lexeme.id = source_sense.lexeme_id
       AND source_lexeme.user_id = ${input.userId}
      JOIN lexical_senses target_sense
        ON target_sense.id = sr.target_sense_id
      JOIN lexemes target_lexeme
        ON target_lexeme.id = target_sense.lexeme_id
       AND target_lexeme.user_id = ${input.userId}
      WHERE sr.user_id = ${input.userId}
        AND (
          sr.source_sense_id = ${input.focusSenseId}
          OR sr.target_sense_id = ${input.focusSenseId}
        )
        AND sr.relation_type IN ${sql(input.relationTypes)}
    )
    SELECT
      ls.id AS "senseId",
      l.normalized_lemma
    FROM incident
    JOIN lexical_senses ls ON ls.id = incident.neighbor_sense_id
    JOIN lexemes l
      ON l.id = ls.lexeme_id
     AND l.user_id = ${input.userId}
    WHERE (
      ${applyAfter} = false
      OR (
        l.normalized_lemma COLLATE "C",
        ls.id
      ) > (
        ${afterLemma} COLLATE "C",
        ${afterSenseId}::uuid
      )
    )
    ORDER BY l.normalized_lemma COLLATE "C", ls.id
    LIMIT ${input.nodeLimit + 1}
  `;
  return {
    senseIds: rows.slice(0, input.nodeLimit).map((row) => row.senseId),
    hasMore: rows.length > input.nodeLimit,
  };
}

async function loadEdges(
  sql: Sql,
  input: NeighborhoodPageInput,
  neighborSenseIds: string[],
) {
  if (neighborSenseIds.length === 0) return [];
  const rows = await sql<EdgeRow[]>`
    WITH incident AS (
      SELECT
        sr.id,
        sr.source_sense_id,
        sr.target_sense_id,
        sr.relation_type,
        sr.origin,
        sr.confidence,
        sr.evidence,
        CASE
          WHEN sr.source_sense_id = ${input.focusSenseId}
            THEN sr.target_sense_id
          ELSE sr.source_sense_id
        END AS neighbor_sense_id
      FROM sense_relations sr
      JOIN lexical_senses source_sense
        ON source_sense.id = sr.source_sense_id
      JOIN lexemes source_lexeme
        ON source_lexeme.id = source_sense.lexeme_id
       AND source_lexeme.user_id = ${input.userId}
      JOIN lexical_senses target_sense
        ON target_sense.id = sr.target_sense_id
      JOIN lexemes target_lexeme
        ON target_lexeme.id = target_sense.lexeme_id
       AND target_lexeme.user_id = ${input.userId}
      WHERE sr.user_id = ${input.userId}
        AND (
          sr.source_sense_id = ${input.focusSenseId}
          OR sr.target_sense_id = ${input.focusSenseId}
        )
        AND sr.relation_type IN ${sql(input.relationTypes)}
    ),
    ranked AS (
      SELECT
        incident.*,
        l.normalized_lemma,
        ROW_NUMBER() OVER (
          PARTITION BY incident.neighbor_sense_id
          ORDER BY incident.relation_type, incident.id
        ) AS edge_rank
      FROM incident
      JOIN lexical_senses ls ON ls.id = incident.neighbor_sense_id
      JOIN lexemes l
        ON l.id = ls.lexeme_id
       AND l.user_id = ${input.userId}
      WHERE incident.neighbor_sense_id IN ${sql(neighborSenseIds)}
    )
    SELECT
      id,
      source_sense_id AS "sourceSenseId",
      target_sense_id AS "targetSenseId",
      relation_type AS "relationType",
      origin,
      confidence,
      evidence
    FROM ranked
    ORDER BY
      edge_rank,
      normalized_lemma COLLATE "C",
      neighbor_sense_id,
      relation_type,
      id
    LIMIT ${input.edgeLimit}
  `;

  return rows.map((row) => ({
    id: row.id,
    source: row.sourceSenseId,
    target: row.targetSenseId,
    type: row.relationType,
    group: relationGroup(row.relationType),
    directed: relationIsDirected(row.relationType),
    origin: row.origin,
    confidenceBand: confidenceBandForScore(row.origin, row.confidence),
    evidence: formatEvidence(row.evidence),
  }));
}

async function loadPage(
  sql: Sql,
  input: NeighborhoodPageInput,
): Promise<NeighborhoodPageRecord> {
  const { senseIds, hasMore } = await loadNeighborIds(sql, input);
  const [nodes, edges] = await Promise.all([
    loadNodes(sql, {
      userId: input.userId,
      deckId: input.deckId,
      focusCardId: input.focusCardId,
      senseIds,
    }),
    loadEdges(sql, input, senseIds),
  ]);
  return { nodes, edges, hasMore };
}

async function loadSummary(
  sql: Sql,
  input: {
    userId: string;
    deckId: string;
    focusSenseId: string;
  },
): Promise<NeighborhoodSummary> {
  const [row] = await sql<SummaryRow[]>`
    WITH owned_relations AS (
      SELECT sr.*
      FROM sense_relations sr
      JOIN lexical_senses source_sense
        ON source_sense.id = sr.source_sense_id
      JOIN lexemes source_lexeme
        ON source_lexeme.id = source_sense.lexeme_id
       AND source_lexeme.user_id = ${input.userId}
      JOIN lexical_senses target_sense
        ON target_sense.id = sr.target_sense_id
      JOIN lexemes target_lexeme
        ON target_lexeme.id = target_sense.lexeme_id
       AND target_lexeme.user_id = ${input.userId}
      WHERE sr.user_id = ${input.userId}
    ),
    deck_counts AS (
      SELECT
        COUNT(*)::int AS deck_cards,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1
            FROM card_senses cs
            JOIN owned_relations relation
              ON relation.source_sense_id = cs.sense_id
              OR relation.target_sense_id = cs.sense_id
            WHERE cs.card_id = c.id
          )
        )::int AS connected_cards
      FROM cards c
      JOIN decks d
        ON d.id = c.deck_id
       AND d.user_id = ${input.userId}
      WHERE c.deck_id = ${input.deckId}
    ),
    group_counts AS (
      SELECT
        COUNT(*) FILTER (
          WHERE relation_type IN ('is_a', 'part_of')
        )::int AS hierarchy_count,
        COUNT(*) FILTER (
          WHERE relation_type IN (
            'synonym',
            'antonym',
            'translation_of',
            'coordinate'
          )
        )::int AS meaning_count,
        COUNT(*) FILTER (
          WHERE relation_type = 'derived_from'
        )::int AS form_count,
        COUNT(*) FILTER (
          WHERE relation_type IN ('collocation', 'confused_with')
        )::int AS usage_count
      FROM owned_relations
      WHERE source_sense_id = ${input.focusSenseId}
         OR target_sense_id = ${input.focusSenseId}
    )
    SELECT
      deck_counts.deck_cards AS "deckCards",
      deck_counts.connected_cards AS "connectedCards",
      group_counts.hierarchy_count AS "hierarchyCount",
      group_counts.meaning_count AS "meaningCount",
      group_counts.form_count AS "formCount",
      group_counts.usage_count AS "usageCount"
    FROM deck_counts
    CROSS JOIN group_counts
  `;
  const deckCards = row?.deckCards ?? 0;
  const connectedCards = row?.connectedCards ?? 0;
  return {
    deckCards,
    connectedCards,
    isolatedCards: Math.max(0, deckCards - connectedCards),
    groupCounts: {
      hierarchy: row?.hierarchyCount ?? 0,
      meaning: row?.meaningCount ?? 0,
      form: row?.formCount ?? 0,
      usage: row?.usageCount ?? 0,
    },
  };
}

async function mapCardSense(
  sql: Sql,
  userId: string,
  cardId: string,
  senseId: string,
): Promise<MapCardSenseResult> {
  const result = await sql.begin(async (rawTransaction) => {
    const transaction = rawTransaction as unknown as Sql;
    const [ownedCard] = await transaction<{ id: string }[]>`
      SELECT c.id
      FROM cards c
      JOIN decks d
        ON d.id = c.deck_id
       AND d.user_id = ${userId}
      WHERE c.id = ${cardId}
      FOR UPDATE OF c
    `;
    if (!ownedCard) return { outcome: 'card_not_found' } as const;

    const [ownedSense] = await transaction<{ id: string }[]>`
      SELECT ls.id
      FROM lexical_senses ls
      JOIN lexemes l
        ON l.id = ls.lexeme_id
       AND l.user_id = ${userId}
      WHERE ls.id = ${senseId}
      LIMIT 1
    `;
    if (!ownedSense) return { outcome: 'sense_not_found' } as const;

    const [existing] = await transaction<MappingRow[]>`
      SELECT
        card_id AS "cardId",
        sense_id AS "senseId",
        source,
        is_primary AS "isPrimary"
      FROM card_senses
      WHERE card_id = ${cardId}
        AND sense_id = ${senseId}
      LIMIT 1
    `;
    if (existing) {
      return {
        outcome: 'mapped',
        mapping: { ...existing, created: false },
      } as const;
    }

    const [primaryState] = await transaction<{ hasPrimary: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM card_senses
        WHERE card_id = ${cardId}
          AND is_primary = true
      ) AS "hasPrimary"
    `;
    const [inserted] = await transaction<MappingRow[]>`
      INSERT INTO card_senses (
        card_id,
        sense_id,
        source,
        is_primary,
        updated_at
      )
      VALUES (
        ${cardId},
        ${senseId},
        'manual',
        ${!primaryState?.hasPrimary},
        now()
      )
      ON CONFLICT (card_id, sense_id) DO NOTHING
      RETURNING
        card_id AS "cardId",
        sense_id AS "senseId",
        source,
        is_primary AS "isPrimary"
    `;
    if (inserted) {
      return {
        outcome: 'mapped',
        mapping: { ...inserted, created: true },
      } as const;
    }

    const [concurrent] = await transaction<MappingRow[]>`
      SELECT
        card_id AS "cardId",
        sense_id AS "senseId",
        source,
        is_primary AS "isPrimary"
      FROM card_senses
      WHERE card_id = ${cardId}
        AND sense_id = ${senseId}
      LIMIT 1
    `;
    if (!concurrent) {
      throw new Error('Card-sense mapping conflict could not be resolved');
    }
    return {
      outcome: 'mapped',
      mapping: { ...concurrent, created: false },
    } as const;
  });
  return result as MapCardSenseResult;
}

export function createPostgresCardNeighborhoodRepository(
  sql: Sql = pgClient,
): CardNeighborhoodRepository {
  return {
    loadFocus: (userId, cardId) => loadFocus(sql, userId, cardId),
    loadPage: (input) => loadPage(sql, input),
    loadSummary: (input) => loadSummary(sql, input),
    mapCardSense: (userId, cardId, senseId) =>
      mapCardSense(sql, userId, cardId, senseId),
  };
}
