import { eq, and, or, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  cardLinks,
  cardConcepts,
  cards,
  decks,
  cardFieldValues,
  templateFields,
  studyProgress,
} from '../../db/schema';
import { searchByEmbedding } from '../embedding/embedding.service';
import { NotFoundError } from '../../shared/errors';

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

export interface PrerequisiteNode {
  cardId: string;
  label: string;
  retention: number | null;
  isWeak: boolean;
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

  // Single query: fetch sample cards + retention data for ALL top concepts at once
  const conceptNames = conceptCounts.map((cc) => cc.concept);
  const sampleRows = await db.execute<{
    concept: string;
    card_id: string;
    stability: number | null;
    interval_days: number | null;
    ease_factor: number | null;
    last_reviewed_at: string | null;
  }>(sql`
    SELECT
      cc2.concept,
      cc2.card_id,
      sp.stability,
      sp.interval_days,
      sp.ease_factor,
      sp.last_reviewed_at::text
    FROM card_concepts cc2
    JOIN cards c ON cc2.card_id = c.id
    JOIN decks d ON c.deck_id = d.id
    LEFT JOIN study_progress sp ON sp.card_id = c.id AND sp.user_id = ${userId}
    WHERE d.user_id = ${userId}
      AND cc2.concept = ANY(${conceptNames})
  `);

  // Group sample rows by concept
  type SampleRow = {
    concept: string;
    card_id: string;
    stability: number | null;
    interval_days: number | null;
    ease_factor: number | null;
    last_reviewed_at: string | null;
  };
  const samplesByConcept = new Map<string, SampleRow[]>();
  for (const sr of sampleRows) {
    const arr = samplesByConcept.get(sr.concept) ?? [];
    if (arr.length < 5) arr.push(sr); // Limit to 5 samples per concept
    samplesByConcept.set(sr.concept, arr);
  }

  const now = Date.now();
  const groups: SmartGroup[] = conceptCounts.map((cc) => {
    const samples = samplesByConcept.get(cc.concept) ?? [];
    let totalR = 0;
    let reviewedCount = 0;

    for (const sr of samples) {
      if (!sr.last_reviewed_at || !sr.interval_days) continue;
      reviewedCount++;
      const elapsed = Math.max(
        0,
        (now - new Date(sr.last_reviewed_at).getTime()) / 86_400_000,
      );
      const S =
        sr.stability && sr.stability > 0
          ? sr.stability
          : Math.max(1, sr.interval_days * ((sr.ease_factor ?? 2.5) / 2.5));
      totalR += Math.exp(-elapsed / S);
    }

    return {
      name: cc.concept,
      cardCount: cc.card_count,
      avgRetention:
        reviewedCount > 0
          ? Math.round((totalR / reviewedCount) * 1000) / 1000
          : null,
      sampleCardIds: samples.map((sr) => sr.card_id),
    };
  });

  return { groups };
}

// ── Prerequisite Chain ───────────────────────────────────────────────────────

/**
 * Walk prerequisite links backwards to build the learning chain.
 * BFS with max depth 10 to prevent infinite loops.
 *
 * Use case: "You forgot card C — review prerequisite A first"
 */
export async function getPrerequisiteChain(
  userId: string,
  cardId: string,
): Promise<{ chain: PrerequisiteNode[]; weakLinks: PrerequisiteNode[] }> {
  const [cardRow] = await db
    .select({ id: cards.id })
    .from(cards)
    .innerJoin(decks, and(eq(cards.deckId, decks.id), eq(decks.userId, userId)))
    .where(eq(cards.id, cardId))
    .limit(1);

  if (!cardRow) throw new NotFoundError('Card');

  // BFS: find all prerequisites leading to this card
  const visited = new Set<string>([cardId]);
  const queue: string[] = [cardId];
  const chainIds: string[] = [];
  const MAX_DEPTH = 10;
  let depth = 0;

  while (queue.length > 0 && depth < MAX_DEPTH) {
    const current = queue.shift()!;

    // Find cards that are prerequisites OF the current card
    const prereqs = await db
      .select({ sourceCardId: cardLinks.sourceCardId })
      .from(cardLinks)
      .where(
        and(
          eq(cardLinks.targetCardId, current),
          eq(cardLinks.linkType, 'prerequisite'),
        ),
      );

    for (const p of prereqs) {
      if (visited.has(p.sourceCardId)) continue;
      visited.add(p.sourceCardId);
      chainIds.push(p.sourceCardId);
      queue.push(p.sourceCardId);
    }

    depth++;
  }

  if (chainIds.length === 0) return { chain: [], weakLinks: [] };

  // Get labels + retention for chain cards
  const labels = await getCardLabelsMap(chainIds);
  const retentions = await getCardRetentions(userId, chainIds);

  const chain: PrerequisiteNode[] = chainIds.map((id) => {
    const R = retentions.get(id) ?? null;
    return {
      cardId: id,
      label: labels.get(id) ?? '',
      retention: R !== null ? Math.round(R * 1000) / 1000 : null,
      isWeak: R !== null && R < 0.8,
    };
  });

  const weakLinks = chain.filter((n) => n.isWeak);

  return { chain, weakLinks };
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

async function getCardLabelsMap(
  cardIds: string[],
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      cardId: cardFieldValues.cardId,
      value: cardFieldValues.value,
      sortOrder: templateFields.sortOrder,
    })
    .from(cardFieldValues)
    .innerJoin(
      templateFields,
      eq(cardFieldValues.templateFieldId, templateFields.id),
    )
    .where(
      and(
        inArray(cardFieldValues.cardId, cardIds),
        eq(templateFields.side, 'front'),
      ),
    )
    .orderBy(templateFields.sortOrder);

  const map = new Map<string, string>();
  for (const r of rows) {
    if (map.has(r.cardId)) continue;
    const text =
      typeof r.value === 'string'
        ? r.value
        : r.value && typeof r.value === 'object' && 'text' in r.value
          ? String((r.value as { text: unknown }).text)
          : JSON.stringify(r.value);
    map.set(r.cardId, text.slice(0, 80));
  }
  return map;
}

async function getCardRetentions(
  userId: string,
  cardIds: string[],
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      cardId: studyProgress.cardId,
      stability: studyProgress.stability,
      intervalDays: studyProgress.intervalDays,
      easeFactor: studyProgress.easeFactor,
      lastReviewedAt: studyProgress.lastReviewedAt,
    })
    .from(studyProgress)
    .where(
      and(
        eq(studyProgress.userId, userId),
        inArray(studyProgress.cardId, cardIds),
      ),
    );

  const now = Date.now();
  const map = new Map<string, number>();

  for (const p of rows) {
    if (!p.lastReviewedAt) continue;
    const elapsed = Math.max(
      0,
      (now - p.lastReviewedAt.getTime()) / 86_400_000,
    );
    const S =
      p.stability && p.stability > 0
        ? p.stability
        : Math.max(1, p.intervalDays * (p.easeFactor / 2.5));
    map.set(p.cardId, Math.exp(-elapsed / S));
  }

  return map;
}
