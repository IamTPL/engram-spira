import { GoogleGenerativeAI } from '@google/generative-ai';
import { sql, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { cardFieldValues, templateFields } from '../../db/schema';
import { ENV } from '../../config/env';
import { logger } from '../../shared/logger';

const embLogger = logger.child({ module: 'embedding' });

// ── Lazy-init Gemini client ──────────────────────────────────────────────────
let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) {
    if (!ENV.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured — embedding disabled');
    }
    _genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);
  }
  return _genAI;
}

// ── Core embedding generation ────────────────────────────────────────────────

/**
 * Generate embedding for a single text string.
 * Returns a 768-dimensional float array.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const model = getGenAI().getGenerativeModel({
    model: ENV.GEMINI_EMBEDDING_MODEL,
  });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

/**
 * Generate embeddings for multiple texts in a single batch API call.
 * Reduces roundtrips: 50 texts in 1 call vs 50 separate calls.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) {
    const single = await generateEmbedding(texts[0]);
    return [single];
  }

  const model = getGenAI().getGenerativeModel({
    model: ENV.GEMINI_EMBEDDING_MODEL,
  });
  const result = await model.batchEmbedContents({
    requests: texts.map((text) => ({
      content: { parts: [{ text }], role: 'user' },
    })),
  });
  return result.embeddings.map((e) => e.values);
}

// ── Card embedding helpers ───────────────────────────────────────────────────

/**
 * Build a single searchable text representation for a card by concatenating
 * its field values. Uses "front" fields first for search relevance.
 */
async function getCardText(cardId: string): Promise<string | null> {
  const fields = await db
    .select({
      value: cardFieldValues.value,
      side: templateFields.side,
      sortOrder: templateFields.sortOrder,
    })
    .from(cardFieldValues)
    .innerJoin(
      templateFields,
      eq(cardFieldValues.templateFieldId, templateFields.id),
    )
    .where(eq(cardFieldValues.cardId, cardId))
    .orderBy(templateFields.side, templateFields.sortOrder);

  if (fields.length === 0) return null;

  // Concatenate: front fields first, then back. Extract text from JSONB value.
  const text = fields
    .map((f) => {
      const val = f.value;
      if (typeof val === 'string') return val;
      if (val && typeof val === 'object' && 'text' in val)
        return String((val as { text: unknown }).text);
      return JSON.stringify(val);
    })
    .filter(Boolean)
    .join(' ');

  return text.trim() || null;
}

/**
 * Generate and store embedding for a single card.
 * Updates the FIRST card_field_value row (typically "front") with the embedding.
 * This is the primary searchable vector for the card.
 */
export async function embedCard(cardId: string): Promise<boolean> {
  const text = await getCardText(cardId);
  if (!text) return false;

  const embedding = await generateEmbedding(text);

  // Store embedding on the first field value row of this card
  // (pgvector column on card_field_values)
  const [firstField] = await db
    .select({ id: cardFieldValues.id })
    .from(cardFieldValues)
    .where(eq(cardFieldValues.cardId, cardId))
    .limit(1);

  if (!firstField) return false;

  await db.execute(sql`
    UPDATE card_field_values
    SET embedding = ${sql.raw(`'[${embedding.join(',')}]'::vector`)}
    WHERE id = ${firstField.id}
  `);

  return true;
}

/**
 * Enqueue a card for async embedding. Fire-and-forget pattern.
 * Logs errors but never throws — card creation must not be blocked.
 */
export function enqueueEmbedding(cardId: string): void {
  embedCard(cardId).catch((err) =>
    embLogger.warn(
      { cardId, err: err instanceof Error ? err.message : String(err) },
      'Failed to generate embedding for card',
    ),
  );
}

// ── Batch backfill ───────────────────────────────────────────────────────────

const BACKFILL_BATCH_SIZE = 50;
const BACKFILL_YIELD_MS = 200;

/**
 * Backfill embeddings for all cards that don't have one yet.
 * Runs in chunked batches with yielding to avoid blocking the event loop.
 * Returns the count of newly embedded cards.
 */
export async function backfillEmbeddings(): Promise<number> {
  let totalEmbedded = 0;

  while (true) {
    // Find cards without embeddings (raw SQL — embedding column not in Drizzle schema)
    const unembeddedCards = await db.execute<{ card_id: string }>(sql`
      SELECT DISTINCT card_id FROM card_field_values
      WHERE embedding IS NULL
      LIMIT ${BACKFILL_BATCH_SIZE}
    `);

    if (unembeddedCards.length === 0) break;

    const cardIds = unembeddedCards.map((r) => r.card_id);

    // Fetch all text for these cards in parallel
    const allFields = await db
      .select({
        cardId: cardFieldValues.cardId,
        value: cardFieldValues.value,
        side: templateFields.side,
        sortOrder: templateFields.sortOrder,
      })
      .from(cardFieldValues)
      .innerJoin(
        templateFields,
        eq(cardFieldValues.templateFieldId, templateFields.id),
      )
      .where(inArray(cardFieldValues.cardId, cardIds))
      .orderBy(templateFields.side, templateFields.sortOrder);

    // Group by card and build text
    const textByCard = new Map<string, string>();
    for (const f of allFields) {
      const existing = textByCard.get(f.cardId) ?? '';
      const val =
        typeof f.value === 'string'
          ? f.value
          : f.value && typeof f.value === 'object' && 'text' in f.value
            ? String((f.value as { text: unknown }).text)
            : JSON.stringify(f.value);
      textByCard.set(f.cardId, existing ? `${existing} ${val}` : val);
    }

    // Prepare batch: only cards with actual text
    const batchCardIds: string[] = [];
    const batchTexts: string[] = [];
    for (const [cardId, text] of textByCard) {
      const trimmed = text.trim();
      if (trimmed) {
        batchCardIds.push(cardId);
        batchTexts.push(trimmed);
      }
    }

    if (batchTexts.length === 0) break;

    try {
      // Batch generate embeddings in single API call
      const embeddings = await generateEmbeddings(batchTexts);

      // Store each embedding
      for (let i = 0; i < batchCardIds.length; i++) {
        const [firstField] = await db
          .select({ id: cardFieldValues.id })
          .from(cardFieldValues)
          .where(eq(cardFieldValues.cardId, batchCardIds[i]))
          .limit(1);

        if (firstField) {
          await db.execute(sql`
            UPDATE card_field_values
            SET embedding = ${sql.raw(`'[${embeddings[i].join(',')}]'::vector`)}
            WHERE id = ${firstField.id}
          `);
        }
      }

      totalEmbedded += batchCardIds.length;
    } catch (err) {
      embLogger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Batch embedding generation failed',
      );
      break; // Don't retry failed batches endlessly
    }

    // Yield to event loop between batches
    await new Promise((resolve) => setTimeout(resolve, BACKFILL_YIELD_MS));
  }

  if (totalEmbedded > 0) {
    embLogger.info({ totalEmbedded }, 'Embedding backfill completed');
  }

  return totalEmbedded;
}

// ── Search by embedding (pgvector cosine similarity) ─────────────────────────

export interface EmbeddingSearchResult {
  cardId: string;
  deckId: string;
  similarity: number;
}

/**
 * Search for cards by embedding similarity using pgvector HNSW index.
 * Returns top-N most similar cards owned by the given user.
 *
 * Performance: ~5-20ms on 100K vectors with HNSW index.
 */
export async function searchByEmbedding(
  queryVector: number[],
  userId: string,
  options: {
    limit?: number;
    deckId?: string;
    threshold?: number;
    excludeCardId?: string;
  } = {},
): Promise<EmbeddingSearchResult[]> {
  const { limit = 20, deckId, threshold = 0.5, excludeCardId } = options;

  // Safe: vector literal is generated from number[] (no user strings)
  const vectorStr = `[${queryVector.join(',')}]`;

  // Build parameterized query — never interpolate user strings into sql.raw()
  const deckFilter = deckId ? sql`AND c.deck_id = ${deckId}` : sql``;
  const excludeFilter = excludeCardId
    ? sql`AND c.id != ${excludeCardId}`
    : sql``;

  const results = await db.execute<{
    card_id: string;
    deck_id: string;
    similarity: number;
  }>(sql`
    SELECT
      c.id AS card_id,
      c.deck_id AS deck_id,
      1 - (cfv.embedding <=> ${sql.raw(`'${vectorStr}'::vector`)}) AS similarity
    FROM card_field_values cfv
    JOIN cards c ON cfv.card_id = c.id
    JOIN decks d ON c.deck_id = d.id
    WHERE d.user_id = ${userId}
      AND cfv.embedding IS NOT NULL
      ${deckFilter}
      ${excludeFilter}
    ORDER BY cfv.embedding <=> ${sql.raw(`'${vectorStr}'::vector`)}
    LIMIT ${limit}
  `);

  return results
    .filter((r) => r.similarity >= threshold)
    .map((r) => ({
      cardId: r.card_id,
      deckId: r.deck_id,
      similarity: r.similarity,
    }));
}

// ── Status helper ────────────────────────────────────────────────────────────

export async function getEmbeddingStatus(): Promise<{
  totalCards: number;
  embeddedCards: number;
  pendingCards: number;
}> {
  const [result] = await db.execute<{
    total: number;
    embedded: number;
  }>(sql`
    SELECT
      COUNT(DISTINCT cfv.card_id)::int AS total,
      COUNT(DISTINCT CASE WHEN cfv.embedding IS NOT NULL THEN cfv.card_id END)::int AS embedded
    FROM card_field_values cfv
  `);

  const total = result?.total ?? 0;
  const embedded = result?.embedded ?? 0;

  return {
    totalCards: total,
    embeddedCards: embedded,
    pendingCards: total - embedded,
  };
}
