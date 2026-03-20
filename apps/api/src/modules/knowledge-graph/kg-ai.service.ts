import { eq, and, sql, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  cards,
  decks,
  cardFieldValues,
  templateFields,
  cardConcepts,
} from '../../db/schema';
import { ENV } from '../../config/env';
import { logger } from '../../shared/logger';
import { NotFoundError } from '../../shared/errors';
import { cosineSimilarity, getCardLabels } from '../../shared/embedding-utils';

const kgAiLogger = logger.child({ module: 'kg-ai' });

// ── Types ────────────────────────────────────────────────────────────────────

export interface RelationshipSuggestion {
  sourceCardId: string;
  targetCardId: string;
  sourceLabel: string;
  targetLabel: string;
  similarity: number;
  suggestedType: 'prerequisite' | 'related';
}

// ── AI Relationship Detection ────────────────────────────────────────────────

/**
 * Detect potential relationships between cards in a deck using embedding similarity.
 *
 * Step 1: For each card, find top-3 nearest neighbors via pgvector (instant).
 * Step 2: Filter pairs above threshold, deduplicate, exclude existing links.
 *
 * Performance: ~20-50ms for a 100-card deck (pure pgvector, no LLM calls).
 * LLM verification is intentionally omitted for speed — user reviews suggestions.
 */
export async function detectRelationships(
  userId: string,
  deckId: string,
  threshold = 0.7,
): Promise<{ suggestions: RelationshipSuggestion[] }> {
  // Verify ownership
  const [deck] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);

  if (!deck) throw new NotFoundError('Deck');

  // Fetch all cards with embeddings in this deck
  const rows = await db.execute<{
    card_id: string;
    embedding: string;
  }>(sql`
    SELECT DISTINCT ON (cfv.card_id) cfv.card_id, cfv.embedding::text
    FROM card_field_values cfv
    JOIN cards c ON cfv.card_id = c.id
    WHERE c.deck_id = ${deckId}
      AND cfv.embedding IS NOT NULL
    ORDER BY cfv.card_id, cfv.id
  `);

  if (rows.length < 2) return { suggestions: [] };

  // Safety limit + parse vectors upfront (once)
  const parsed = rows.slice(0, 500).map((r) => ({
    cardId: r.card_id,
    vec: JSON.parse(r.embedding) as number[],
  }));

  // Half-matrix: only i < j (symmetric similarity, no need for full N²)
  const candidatePairs = new Map<
    string,
    { src: string; tgt: string; sim: number }
  >();

  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const sim = cosineSimilarity(parsed[i].vec, parsed[j].vec);

      if (sim >= threshold) {
        const [a, b] =
          parsed[i].cardId < parsed[j].cardId
            ? [parsed[i].cardId, parsed[j].cardId]
            : [parsed[j].cardId, parsed[i].cardId];

        const key = `${a}:${b}`;
        const existing = candidatePairs.get(key);
        if (!existing || sim > existing.sim) {
          candidatePairs.set(key, { src: a, tgt: b, sim });
        }
      }
    }
  }

  if (candidatePairs.size === 0) return { suggestions: [] };

  // Filter out already-linked pairs
  const allCardIds = rows.map((r) => r.card_id);

  let existingLinks: { source_card_id: string; target_card_id: string }[] = [];
  if (allCardIds.length > 0) {
    const { pgClient } = await import('../../db');
    existingLinks = await pgClient<{ source_card_id: string; target_card_id: string }[]>`
      SELECT source_card_id, target_card_id FROM card_links
      WHERE source_card_id = ANY(${allCardIds}::uuid[])
         OR target_card_id = ANY(${allCardIds}::uuid[])
    `;
  }

  const linkedSet = new Set(
    existingLinks.map((l) =>
      l.source_card_id < l.target_card_id
        ? `${l.source_card_id}:${l.target_card_id}`
        : `${l.target_card_id}:${l.source_card_id}`,
    ),
  );

  // Get card labels for display
  const labels = await getCardLabels(allCardIds);

  const suggestions: RelationshipSuggestion[] = [];
  for (const [key, pair] of candidatePairs) {
    if (linkedSet.has(key)) continue; // Already linked

    suggestions.push({
      sourceCardId: pair.src,
      targetCardId: pair.tgt,
      sourceLabel: labels.get(pair.src) ?? '',
      targetLabel: labels.get(pair.tgt) ?? '',
      similarity: Math.round(pair.sim * 1000) / 1000,
      suggestedType: 'related',
    });
  }

  // Sort by similarity descending, limit to top 20
  suggestions.sort((a, b) => b.similarity - a.similarity);

  return { suggestions: suggestions.slice(0, 20) };
}

// ── Auto Concept Extraction ──────────────────────────────────────────────────

/**
 * Extract key concepts from a card using Gemini LLM.
 * Saves to card_concepts table.
 *
 * Designed to be called as a fire-and-forget hook during embedding pipeline.
 */
export async function extractConcepts(
  cardId: string,
  cardText: string,
): Promise<string[]> {
  if (!cardText.trim() || !ENV.GEMINI_API_KEY) return [];

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: ENV.GEMINI_MODEL });

    const result = await model.generateContent(
      `Extract 2-5 key concepts or topics from this flashcard content. Return ONLY a JSON array of strings, nothing else.\n\nContent: ${cardText.slice(0, 500)}`,
    );

    const text = result.response.text().trim();
    // Parse JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const concepts = JSON.parse(match[0]) as string[];
    if (!Array.isArray(concepts)) return [];

    const validConcepts = concepts
      .filter((c) => typeof c === 'string' && c.trim())
      .map((c) => c.trim().toLowerCase())
      .slice(0, 5);

    // Save to DB
    if (validConcepts.length > 0) {
      await db
        .insert(cardConcepts)
        .values(validConcepts.map((concept) => ({ cardId, concept })))
        .onConflictDoNothing();
    }

    return validConcepts;
  } catch (err) {
    kgAiLogger.warn(
      { cardId, err: err instanceof Error ? err.message : String(err) },
      'Failed to extract concepts',
    );
    return [];
  }
}

// getCardLabels and cosineSimilarity imported from ../../shared/embedding-utils
