import { eq, and, or, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  cardLinks,
  cardConcepts,
  cards,
  decks,
  cardFieldValues,
  templateFields,
} from '../../db/schema';
import { searchByEmbedding } from '../embedding/embedding.service';
import { getCardLabels } from '../../shared/embedding-utils';
import { NotFoundError } from '../../shared/errors';
import { fsrsRetrievability, fsrsStateJoin } from './fsrs-sql';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RelatedCard {
  cardId: string;
  deckId: string;
  deckName: string;
  source: 'link' | 'semantic';
  similarity: number | null;
  linkType: string | null;
  fields: { fieldName: string; side: string; value: unknown }[];
}

export interface SmartGroup {
  name: string;
  cardCount: number;
  avgRetention: number | null;
  sampleCardIds: string[];
}



// ── Related Cards ────────────────────────────────────────────────────────────

/**
 * Get related cards for a given card:
 * 1. Explicit links (card_links) — instant, indexed
 * 2. If fewer than limit, supplement with embedding similarity — ~10ms pgvector
 *
 * Use case: "Again" button → show related cards to review together
 */
export async function getRelatedCards(
  userId: string,
  cardId: string,
  limit = 5,
): Promise<{ related: RelatedCard[] }> {
  // Verify ownership
  const [cardRow] = await db
    .select({ id: cards.id, deckId: cards.deckId })
    .from(cards)
    .innerJoin(decks, and(eq(cards.deckId, decks.id), eq(decks.userId, userId)))
    .where(eq(cards.id, cardId))
    .limit(1);

  if (!cardRow) throw new NotFoundError('Card');

  // Step 1: Explicit links
  const links = await db
    .select({
      id: cardLinks.id,
      sourceCardId: cardLinks.sourceCardId,
      targetCardId: cardLinks.targetCardId,
      linkType: cardLinks.linkType,
    })
    .from(cardLinks)
    .where(
      or(
        eq(cardLinks.sourceCardId, cardId),
        eq(cardLinks.targetCardId, cardId),
      ),
    );

  const linkedCardIds = links.map((l) =>
    l.sourceCardId === cardId ? l.targetCardId : l.sourceCardId,
  );
  const linkTypeMap = new Map(
    links.map((l) => [
      l.sourceCardId === cardId ? l.targetCardId : l.sourceCardId,
      l.linkType,
    ]),
  );

  const results: {
    cardId: string;
    source: 'link' | 'semantic';
    similarity: number | null;
    linkType: string | null;
  }[] = linkedCardIds.slice(0, limit).map((id) => ({
    cardId: id,
    source: 'link' as const,
    similarity: null,
    linkType: linkTypeMap.get(id) ?? null,
  }));

  // Step 2: Supplement with semantic if needed
  if (results.length < limit) {
    const remaining = limit - results.length;
    const existingIds = new Set([cardId, ...linkedCardIds]);

    try {
      // Get current card's embedding
      const [embRow] = await db.execute<{ embedding: string }>(sql`
        SELECT embedding::text FROM card_field_values
        WHERE card_id = ${cardId} AND embedding IS NOT NULL
        LIMIT 1
      `);

      if (embRow?.embedding) {
        const queryVector = JSON.parse(embRow.embedding) as number[];
        const semanticMatches = await searchByEmbedding(queryVector, userId, {
          limit: remaining + existingIds.size,
          threshold: 0.5,
          excludeCardId: cardId,
        });

        for (const m of semanticMatches) {
          if (existingIds.has(m.cardId)) continue;
          if (results.length >= limit) break;
          results.push({
            cardId: m.cardId,
            source: 'semantic',
            similarity: m.similarity,
            linkType: null,
          });
        }
      }
    } catch {
      // Embedding not available — that's fine, return link-only results
    }
  }

  if (results.length === 0) return { related: [] };

  // Enrich with fields + deck names
  const allCardIds = results.map((r) => r.cardId);
  const enriched = await enrichCardResults(allCardIds);

  const related: RelatedCard[] = results.map((r) => ({
    cardId: r.cardId,
    deckId: enriched.deckMap.get(r.cardId) ?? '',
    deckName:
      enriched.deckNameMap.get(enriched.deckMap.get(r.cardId) ?? '') ?? '',
    source: r.source,
    similarity: r.similarity ? Math.round(r.similarity * 1000) / 1000 : null,
    linkType: r.linkType,
    fields: (enriched.fieldsByCard.get(r.cardId) ?? []).map((f) => ({
      fieldName: f.fieldName,
      side: f.side,
      value: f.value,
    })),
  }));

  return { related };
}

// ── Smart Groups ─────────────────────────────────────────────────────────────

/**
 * Group user's cards by concept (from card_concepts table).
 * Returns top-N groups sorted by card count.
 *
 * Performance: single GROUP BY query — no heavy clustering.
 */
export async function getSmartGroups(
  userId: string,
  topN = 5,
  asOf: Date = new Date(),
): Promise<{ groups: SmartGroup[] }> {
  // Get concept counts across user's cards
  const conceptCounts = await db.execute<{
    concept: string;
    card_count: number;
  }>(sql`
    SELECT cc.concept, COUNT(DISTINCT cc.card_id)::int AS card_count
    FROM card_concepts cc
    JOIN cards c ON cc.card_id = c.id
    JOIN decks d ON c.deck_id = d.id
    WHERE d.user_id = ${userId}
    GROUP BY cc.concept
    ORDER BY card_count DESC
    LIMIT ${topN}
  `);

  if (conceptCounts.length === 0) return { groups: [] };

  // A bare JS array binds as a row constructor `($1, $2, …)` through drizzle's
  // `sql`, which `= ANY(…)` rejects — expand it into an `ARRAY[…]` of
  // parameters instead (at most `topN` of them).
  const conceptNames = sql.join(
    conceptCounts.map((cc) => sql`${cc.concept}`),
    sql`, `,
  );

  // Single canonical statement: average predicted recall + up to 5 sample cards
  // for ALL top concepts at once. Retention comes from `fsrs_card_states` +
  // `fsrs_parameter_revisions`; AVG ignores never-reviewed (NULL) cards, so
  // `avgRetention` is NULL for a concept with none.
  const groupRows = await db.execute<{
    concept: string;
    avgRetention: number | null;
    sampleCardIds: string[] | null;
  }>(sql`
    WITH scored AS (
      SELECT
        cc2.concept,
        c.id AS card_id,
        ${fsrsRetrievability(asOf)} AS retention,
        ROW_NUMBER() OVER (
          PARTITION BY cc2.concept ORDER BY c.id
        ) AS rn
      FROM card_concepts cc2
      JOIN cards c ON cc2.card_id = c.id
      JOIN decks d ON c.deck_id = d.id AND d.user_id = ${userId}::uuid
      ${fsrsStateJoin(userId)}
      WHERE cc2.concept = ANY(ARRAY[${conceptNames}]::text[])
    )
    SELECT
      concept,
      AVG(retention)::double precision AS "avgRetention",
      ARRAY_AGG(card_id::text ORDER BY rn) FILTER (WHERE rn <= 5)
        AS "sampleCardIds"
    FROM scored
    GROUP BY concept
  `);

  const scoredByConcept = new Map(
    groupRows.map((row) => [row.concept, row] as const),
  );

  const groups: SmartGroup[] = conceptCounts.map((cc) => {
    const scored = scoredByConcept.get(cc.concept);
    return {
      name: cc.concept,
      cardCount: cc.card_count,
      avgRetention:
        scored?.avgRetention == null ? null : roundMetric(scored.avgRetention),
      sampleCardIds: scored?.sampleCardIds ?? [],
    };
  });

  return { groups };
}



// ── Helpers ──────────────────────────────────────────────────────────────────

async function enrichCardResults(cardIds: string[]) {
  const [fieldRows, cardDeckRows] = await Promise.all([
    db
      .select({
        cardId: cardFieldValues.cardId,
        fieldName: templateFields.name,
        side: templateFields.side,
        value: cardFieldValues.value,
      })
      .from(cardFieldValues)
      .innerJoin(
        templateFields,
        eq(cardFieldValues.templateFieldId, templateFields.id),
      )
      .where(inArray(cardFieldValues.cardId, cardIds)),
    db
      .select({ cardId: cards.id, deckId: cards.deckId, deckName: decks.name })
      .from(cards)
      .innerJoin(decks, eq(cards.deckId, decks.id))
      .where(inArray(cards.id, cardIds)),
  ]);

  const fieldsByCard = new Map<string, typeof fieldRows>();
  for (const f of fieldRows) {
    const arr = fieldsByCard.get(f.cardId) ?? [];
    arr.push(f);
    fieldsByCard.set(f.cardId, arr);
  }

  const deckMap = new Map(cardDeckRows.map((r) => [r.cardId, r.deckId]));
  const deckNameMap = new Map(cardDeckRows.map((r) => [r.deckId, r.deckName]));

  return { fieldsByCard, deckMap, deckNameMap };
}

// getCardLabels imported from ../../shared/embedding-utils
// (replaces local getCardLabelsMap)

async function getCardRetentions(
  userId: string,
  cardIds: string[],
  asOf: Date = new Date(),
): Promise<Map<string, number>> {
  if (cardIds.length === 0) return new Map();

  // Bind one PostgreSQL array value instead of one parameter per card: a bare
  // JS array becomes a row constructor through drizzle's `sql`, and a parameter
  // per card would hit the 65,535 bind-parameter ceiling on large selections.
  const cardIdArrayLiteral = `{${cardIds.join(',')}}`;
  const rows = await db.execute<{
    cardId: string;
    retention: number;
  }>(sql`
    SELECT c.id::text AS "cardId", ${fsrsRetrievability(asOf)} AS retention
    FROM cards c
    ${fsrsStateJoin(userId)}
    WHERE c.id = ANY(${cardIdArrayLiteral}::uuid[]) AND s.id IS NOT NULL
  `);

  return new Map(rows.map((row) => [row.cardId, row.retention] as const));
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}
