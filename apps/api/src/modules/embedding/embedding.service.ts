import { sql, eq, inArray } from 'drizzle-orm';
import { db, pgClient } from '../../db';
import { cardFieldValues, templateFields } from '../../db/schema';
import { getCardText, getCardTexts } from '../../shared/embedding-utils';
import {
  createCoalescingEnqueuer,
  createConcurrencyLimiter,
} from '../../shared/concurrency';
import { logger } from '../../shared/logger';
import {
  getGeminiProvider,
  type GeminiProvider,
} from '../ai/gemini-provider';
import { writeLegacyCardEmbedding } from './card-embedding-storage';

const embLogger = logger.child({ module: 'embedding' });
const MAX_CONCURRENT_CARD_EMBEDDINGS = 4;
const runWithCardEmbeddingSlot = createConcurrencyLimiter(
  MAX_CONCURRENT_CARD_EMBEDDINGS,
);

// ── Core embedding generation ────────────────────────────────────────────────

/**
 * Generate embedding for a single text string.
 * Returns a 768-dimensional float array (Matryoshka truncation from 3072d).
 */
export async function generateEmbedding(
  text: string,
  provider: Pick<GeminiProvider, 'embedTexts'> = getGeminiProvider(),
): Promise<number[]> {
  const result = await provider.embedTexts([text]);
  return result.value[0];
}

/**
 * Generate embeddings for multiple texts in a single batch API call.
 * Reduces roundtrips: 50 texts in 1 call vs 50 separate calls.
 */
export async function generateEmbeddings(
  texts: string[],
  provider: Pick<GeminiProvider, 'embedTexts'> = getGeminiProvider(),
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const result = await provider.embedTexts(texts);
  return result.value;
}

// ── Card embedding helpers ───────────────────────────────────────────────────

// getCardText is imported from ../../shared/embedding-utils

/**
 * Generate and store embedding for a single card.
 * Stores one searchable vector for the card.
 */
export async function embedCard(cardId: string): Promise<boolean> {
  const text = await getCardText(cardId);
  if (!text) return false;

  const embedding = await generateEmbedding(text);

  return storeCardEmbedding(cardId, embedding);
}

const enqueueCardEmbedding = createCoalescingEnqueuer(
  (cardId: string) => runWithCardEmbeddingSlot(() => embedCard(cardId)),
  (cardId, err) => {
    embLogger.warn(
      { cardId, err: err instanceof Error ? err.message : String(err) },
      'Failed to generate embedding for card',
    );
  },
);

/**
 * Enqueue a card for async embedding. Fire-and-forget pattern.
 * Logs errors but never throws — card creation must not be blocked.
 */
export function enqueueEmbedding(cardId: string): void {
  enqueueCardEmbedding(cardId);
}

/**
 * Batch embed multiple cards in a single API call.
 * Much more efficient than calling embedCard() N times sequentially.
 * Uses generateEmbeddings() for a single API roundtrip.
 */
export async function embedCardBatch(
  cardIds: string[],
  onlyIfMissing = false,
): Promise<number> {
  if (cardIds.length === 0) return 0;

  // Fetch all card texts in one query, then restore caller order and duplicates.
  const textByCard = await getCardTexts(cardIds);
  const cardTexts: { cardId: string; text: string }[] = [];
  for (const id of cardIds) {
    const text = textByCard.get(id);
    if (text) cardTexts.push({ cardId: id, text });
  }

  if (cardTexts.length === 0) return 0;

  // Batch generate embeddings (single API call)
  const embeddings = await generateEmbeddings(cardTexts.map((c) => c.text));

  let stored = 0;
  for (let i = 0; i < cardTexts.length; i++) {
    if (
      await storeCardEmbedding(
        cardTexts[i].cardId,
        embeddings[i],
        onlyIfMissing,
      )
    ) {
      stored++;
    }
  }

  embLogger.info(
    { total: cardIds.length, embedded: stored },
    'Batch embedding complete',
  );

  return stored;
}

// ── Vector storage helper ─────────────────────────────────────────────────────

/**
 * Store embedding vector in card_field_values row.
 * Uses raw SQL query to handle pgvector casting correctly.
 * Drizzle's sql.raw() chokes on 3072-dim vectors (~25KB),
 * so we build a minimal raw query string here.
 */
async function storeCardEmbedding(
  cardId: string,
  embedding: number[],
  onlyIfMissing = false,
): Promise<boolean> {
  return writeLegacyCardEmbedding(cardId, embedding, onlyIfMissing);
}

// ── Batch backfill ───────────────────────────────────────────────────────────

const BACKFILL_BATCH_SIZE = 50;
const BACKFILL_YIELD_MS = 200;
let activeBackfill: Promise<number> | null = null;

/**
 * Backfill embeddings for all cards that don't have one yet.
 * Runs in chunked batches with yielding to avoid blocking the event loop.
 * Returns the count of newly embedded cards.
 */
export function backfillEmbeddings(): Promise<number> {
  if (activeBackfill) return activeBackfill;

  const promise = runBackfillEmbeddings().then(
    (result) => {
      if (activeBackfill === promise) activeBackfill = null;
      return result;
    },
    (error) => {
      if (activeBackfill === promise) activeBackfill = null;
      throw error;
    },
  );
  activeBackfill = promise;
  return promise;
}

async function runBackfillEmbeddings(): Promise<number> {
  let totalEmbedded = 0;
  let lastScannedCardId: string | null = null;

  while (true) {
    // Find cards that have NO embedding on any of their field value rows.
    // A card has multiple cfv rows (one per field); only one gets the vector.
    // We must skip cards that already have an embedding on ANY row.
    const unembeddedCards: { card_id: string }[] = await db.execute<{
      card_id: string;
    }>(sql`
      SELECT DISTINCT cfv.card_id
      FROM card_field_values cfv
      WHERE NOT EXISTS (
        SELECT 1 FROM card_field_values cfv2
        WHERE cfv2.card_id = cfv.card_id
          AND cfv2.embedding IS NOT NULL
      )
      ${
        lastScannedCardId
          ? sql`AND cfv.card_id > ${lastScannedCardId}::uuid`
          : sql``
      }
      ORDER BY cfv.card_id
      LIMIT ${BACKFILL_BATCH_SIZE}
    `);

    if (unembeddedCards.length === 0) break;

    const cardIds: string[] = unembeddedCards.map((r) => r.card_id);
    lastScannedCardId = cardIds[cardIds.length - 1];

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

    if (batchTexts.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, BACKFILL_YIELD_MS));
      continue;
    }

    try {
      // Batch generate embeddings in single API call
      const embeddings = await generateEmbeddings(batchTexts);
      // Store each embedding
      for (let i = 0; i < batchCardIds.length; i++) {
        if (
          await storeCardEmbedding(batchCardIds[i], embeddings[i], true)
        ) {
          totalEmbedded++;
        }
      }
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
 * Search for cards by embedding similarity using pgvector cosine distance.
 * Returns top-N most similar cards owned by the given user.
 * Uses postgres-js client directly (Drizzle can't handle 3072-dim vector strings).
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

  // Build query with conditional clauses
  const results = await pgClient<{
    card_id: string;
    deck_id: string;
    similarity: number;
  }[]>`
    SELECT
      c.id AS card_id,
      c.deck_id AS deck_id,
      1 - (cfv.embedding <=> ${vectorStr}::vector) AS similarity
    FROM card_field_values cfv
    JOIN cards c ON cfv.card_id = c.id
    JOIN decks d ON c.deck_id = d.id
    WHERE d.user_id = ${userId}
      AND cfv.embedding IS NOT NULL
      ${deckId ? pgClient`AND c.deck_id = ${deckId}` : pgClient``}
      ${excludeCardId ? pgClient`AND c.id != ${excludeCardId}` : pgClient``}
    ORDER BY cfv.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `;

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
