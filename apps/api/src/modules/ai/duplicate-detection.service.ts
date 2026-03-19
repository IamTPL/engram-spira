import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { cardFieldValues, cards, decks, templateFields } from '../../db/schema';
import {
  generateEmbedding,
  searchByEmbedding,
} from '../embedding/embedding.service';
import { logger } from '../../shared/logger';

const dupLogger = logger.child({ module: 'duplicate-detection' });

export interface DuplicateMatch {
  cardId: string;
  deckId: string;
  deckName: string;
  similarity: number;
  fields: { fieldName: string; side: string; value: unknown }[];
}

/**
 * Check if a card (by ID) has duplicates across the user's collection.
 * Uses embedding cosine similarity via pgvector HNSW index.
 *
 * Performance: ~60-80ms (50ms embedding lookup + 10-20ms pgvector search)
 */
export async function checkDuplicatesByCardId(
  userId: string,
  cardId: string,
  threshold = 0.85,
): Promise<{ duplicates: DuplicateMatch[] }> {
  // Get the card's existing embedding vector
  const [row] = await db.execute<{ embedding: string }>(sql`
    SELECT embedding::text
    FROM card_field_values
    WHERE card_id = ${cardId} AND embedding IS NOT NULL
    LIMIT 1
  `);

  if (!row?.embedding) {
    // Card has no embedding yet — generate from text
    const text = await getCardText(cardId);
    if (!text) return { duplicates: [] };

    const queryVector = await generateEmbedding(text);
    return findDuplicates(userId, queryVector, cardId, threshold);
  }

  // Parse existing embedding
  const queryVector = JSON.parse(row.embedding) as number[];
  return findDuplicates(userId, queryVector, cardId, threshold);
}

/**
 * Check if field values (for a card being created/edited) have duplicates.
 * Does NOT require an existing card ID — works with raw text input.
 *
 * Performance: ~60-80ms (50ms embedding gen + 10-20ms pgvector search)
 */
export async function checkDuplicatesByText(
  userId: string,
  text: string,
  excludeCardId?: string,
  threshold = 0.85,
): Promise<{ duplicates: DuplicateMatch[] }> {
  if (!text.trim()) return { duplicates: [] };

  const queryVector = await generateEmbedding(text.trim());
  return findDuplicates(userId, queryVector, excludeCardId, threshold);
}

/**
 * Scan an entire deck for internal duplicate pairs.
 * Returns pairs of cards with similarity > threshold.
 */
export async function scanDeckDuplicates(
  userId: string,
  deckId: string,
  threshold = 0.85,
): Promise<{
  pairs: { cardA: string; cardB: string; similarity: number }[];
}> {
  // Verify ownership
  const [deck] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);

  if (!deck) return { pairs: [] };

  // Fetch all card embeddings in this deck using raw SQL
  const rows = await db.execute<{
    card_id: string;
    embedding: string;
  }>(sql`
    SELECT cfv.card_id, cfv.embedding::text
    FROM card_field_values cfv
    JOIN cards c ON cfv.card_id = c.id
    WHERE c.deck_id = ${deckId}
      AND cfv.embedding IS NOT NULL
    ORDER BY c.sort_order
  `);

  if (rows.length < 2) return { pairs: [] };

  // Safety limit: O(N²) is too expensive above 500 cards
  const limitedRows = rows.slice(0, 500);

  // Parse all vectors upfront (once) instead of inside nested loop
  const parsed = limitedRows.map((r) => ({
    cardId: r.card_id,
    vec: JSON.parse(r.embedding) as number[],
  }));

  // Pairwise comparison using cosine similarity — O(N²/2)
  const pairs: { cardA: string; cardB: string; similarity: number }[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const vecA = parsed[i].vec;

    for (let j = i + 1; j < parsed.length; j++) {
      const vecB = parsed[j].vec;
      const sim = cosineSimilarity(vecA, vecB);

      if (sim >= threshold) {
        pairs.push({
          cardA: parsed[i].cardId,
          cardB: parsed[j].cardId,
          similarity: Math.round(sim * 1000) / 1000,
        });
      }
    }
  }

  // Sort by similarity descending
  pairs.sort((a, b) => b.similarity - a.similarity);

  return { pairs };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function findDuplicates(
  userId: string,
  queryVector: number[],
  excludeCardId: string | undefined,
  threshold: number,
): Promise<{ duplicates: DuplicateMatch[] }> {
  const matches = await searchByEmbedding(queryVector, userId, {
    limit: 5,
    threshold,
    excludeCardId,
  });

  if (matches.length === 0) return { duplicates: [] };

  // Enrich with fields + deck names
  const cardIds = matches.map((m) => m.cardId);
  const deckIds = [...new Set(matches.map((m) => m.deckId))];

  const [fieldRows, deckRows] = await Promise.all([
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
      .select({ id: decks.id, name: decks.name })
      .from(decks)
      .where(inArray(decks.id, deckIds)),
  ]);

  const fieldsByCard = new Map<string, typeof fieldRows>();
  for (const f of fieldRows) {
    const arr = fieldsByCard.get(f.cardId) ?? [];
    arr.push(f);
    fieldsByCard.set(f.cardId, arr);
  }
  const deckNameMap = new Map(deckRows.map((d) => [d.id, d.name]));

  const duplicates: DuplicateMatch[] = matches.map((m) => ({
    cardId: m.cardId,
    deckId: m.deckId,
    deckName: deckNameMap.get(m.deckId) ?? '',
    similarity: Math.round(m.similarity * 1000) / 1000,
    fields: (fieldsByCard.get(m.cardId) ?? []).map((f) => ({
      fieldName: f.fieldName,
      side: f.side,
      value: f.value,
    })),
  }));

  return { duplicates };
}

async function getCardText(cardId: string): Promise<string | null> {
  const fields = await db
    .select({ value: cardFieldValues.value })
    .from(cardFieldValues)
    .where(eq(cardFieldValues.cardId, cardId));

  if (fields.length === 0) return null;

  const text = fields
    .map((f) => {
      if (typeof f.value === 'string') return f.value;
      if (f.value && typeof f.value === 'object' && 'text' in f.value)
        return String((f.value as { text: unknown }).text);
      return JSON.stringify(f.value);
    })
    .filter(Boolean)
    .join(' ');

  return text.trim() || null;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}
