import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { cardFieldValues, cards, decks, templateFields } from '../../db/schema';
import {
  generateEmbedding,
  searchByEmbedding,
} from '../embedding/embedding.service';
import { getCardText, getCardLabels, cosineSimilarity } from '../../shared/embedding-utils';
import { logger } from '../../shared/logger';
import { AppError } from '../../shared/errors';

const dupLogger = logger.child({ module: 'duplicate-detection' });

/** Check if the embedding column exists in card_field_values table */
export async function isEmbeddingAvailable(): Promise<boolean> {
  try {
    const [row] = await db.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'card_field_values' AND column_name = 'embedding'
      ) AS exists
    `);
    return row?.exists ?? false;
  } catch {
    return false;
  }
}

function assertEmbeddingAvailable(available: boolean): void {
  if (!available) {
    throw new AppError(
      422,
      'Embedding infrastructure not available. Run POST /embedding/backfill first.',
    );
  }
}

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
  assertEmbeddingAvailable(await isEmbeddingAvailable());

  // Get the card's existing embedding vector
  let row: { embedding: string } | undefined;
  [row] = await db.execute<{ embedding: string }>(sql`
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
 * Uses exact text matching on the "word" field (case-insensitive, trimmed).
 * Returns duplicate pairs with full field data for compare view.
 */
export async function scanDeckDuplicates(
  userId: string,
  deckId: string,
): Promise<{
  pairs: DuplicatePairDetail[];
}> {
  // Verify ownership
  const [deck] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);

  if (!deck) return { pairs: [] };

  // Fetch all card field values in this deck, grouped by card
  const allFieldValues = await db
    .select({
      cardId: cardFieldValues.cardId,
      fieldName: templateFields.name,
      fieldType: templateFields.fieldType,
      side: templateFields.side,
      sortOrder: templateFields.sortOrder,
      value: cardFieldValues.value,
    })
    .from(cardFieldValues)
    .innerJoin(templateFields, eq(cardFieldValues.templateFieldId, templateFields.id))
    .innerJoin(cards, eq(cardFieldValues.cardId, cards.id))
    .where(eq(cards.deckId, deckId))
    .orderBy(cardFieldValues.cardId, templateFields.sortOrder);

  // Group fields by card
  const cardFieldsMap = new Map<string, typeof allFieldValues>();
  for (const fv of allFieldValues) {
    const arr = cardFieldsMap.get(fv.cardId) ?? [];
    arr.push(fv);
    cardFieldsMap.set(fv.cardId, arr);
  }

  // Build word→cardId[] index for exact text matching
  const wordIndex = new Map<string, string[]>();
  for (const [cardId, fields] of cardFieldsMap) {
    const wordField = fields.find(
      (f) => f.fieldName.toLowerCase() === 'word' || f.fieldName.toLowerCase() === 'term',
    );
    if (!wordField || !wordField.value) continue;
    const normalizedWord = String(wordField.value).trim().toLowerCase();
    if (!normalizedWord) continue;

    const existing = wordIndex.get(normalizedWord) ?? [];
    existing.push(cardId);
    wordIndex.set(normalizedWord, existing);
  }

  // Find groups with 2+ cards sharing the same word → duplicates
  const pairs: DuplicatePairDetail[] = [];

  for (const [word, cardIds] of wordIndex) {
    if (cardIds.length < 2) continue;

    // For each unique pair in this group
    for (let i = 0; i < cardIds.length; i++) {
      for (let j = i + 1; j < cardIds.length; j++) {
        const fieldsA = cardFieldsMap.get(cardIds[i]) ?? [];
        const fieldsB = cardFieldsMap.get(cardIds[j]) ?? [];

        pairs.push({
          cardA: cardIds[i],
          cardB: cardIds[j],
          word,
          fieldsA: fieldsA.map((f) => ({
            fieldName: f.fieldName,
            side: f.side,
            value: f.value,
          })),
          fieldsB: fieldsB.map((f) => ({
            fieldName: f.fieldName,
            side: f.side,
            value: f.value,
          })),
        });
      }
    }
  }

  dupLogger.info({ deckId, pairsFound: pairs.length }, 'Duplicate scan completed');
  return { pairs };
}

export interface DuplicatePairDetail {
  cardA: string;
  cardB: string;
  word: string;
  fieldsA: { fieldName: string; side: string; value: unknown }[];
  fieldsB: { fieldName: string; side: string; value: unknown }[];
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

// getCardText, getCardLabels, cosineSimilarity imported from ../../shared/embedding-utils
