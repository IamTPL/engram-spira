import { sql, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  cardFieldValues,
  cards,
  decks,
  templateFields,
} from '../../db/schema';
import { generateEmbedding, searchByEmbedding } from '../embedding/embedding.service';
import { logger } from '../../shared/logger';

const searchLogger = logger.child({ module: 'search' });

export interface SearchResult {
  cardId: string;
  deckId: string;
  deckName: string;
  similarity: number;
  fields: {
    fieldName: string;
    fieldType: string;
    side: string;
    value: unknown;
  }[];
}

/**
 * Semantic search: embed query → pgvector cosine similarity.
 * Falls back to text search if embedding fails or no embeddings exist.
 *
 * Performance:
 *  - Embedding generation: ~50ms (1 API call)
 *  - pgvector HNSW search: ~5-20ms on 100K vectors
 *  - Field enrichment: single batch query
 *  - Total: ~70-120ms
 */
export async function search(
  userId: string,
  query: string,
  options: { limit?: number; deckId?: string } = {},
): Promise<{ results: SearchResult[]; query: string; total: number }> {
  const { limit = 20, deckId } = options;
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return { results: [], query: trimmedQuery, total: 0 };
  }

  // Try semantic search first, fall back to text search
  let results: SearchResult[];
  try {
    results = await semanticSearch(userId, trimmedQuery, { limit, deckId });
  } catch (err) {
    searchLogger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'Semantic search failed, falling back to text search',
    );
    results = await textSearch(userId, trimmedQuery, { limit, deckId });
  }

  // If semantic search returned nothing, supplement with text search
  if (results.length === 0) {
    results = await textSearch(userId, trimmedQuery, { limit, deckId });
  }

  return { results, query: trimmedQuery, total: results.length };
}

// ── Semantic search (embedding-based) ────────────────────────────────────────

async function semanticSearch(
  userId: string,
  query: string,
  options: { limit: number; deckId?: string },
): Promise<SearchResult[]> {
  // 1. Generate embedding for search query (~50ms, 1 API call)
  const queryVector = await generateEmbedding(query);

  // 2. pgvector cosine similarity search (~5-20ms with HNSW)
  const matches = await searchByEmbedding(queryVector, userId, {
    limit: options.limit,
    deckId: options.deckId,
    threshold: 0.4,
  });

  if (matches.length === 0) return [];

  // 3. Enrich with card fields + deck names (single batch query)
  return enrichResults(matches);
}

// ── Text search (ILIKE fallback) ─────────────────────────────────────────────

async function textSearch(
  userId: string,
  query: string,
  options: { limit: number; deckId?: string },
): Promise<SearchResult[]> {
  const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`;

  const deckFilter = options.deckId
    ? sql`AND c.deck_id = ${options.deckId}`
    : sql``;

  const rows = await db.execute<{
    card_id: string;
    deck_id: string;
  }>(sql`
    SELECT DISTINCT c.id AS card_id, c.deck_id AS deck_id
    FROM card_field_values cfv
    JOIN cards c ON cfv.card_id = c.id
    JOIN decks d ON c.deck_id = d.id
    WHERE d.user_id = ${userId}
      AND cfv.value::text ILIKE ${pattern}
      ${deckFilter}
    LIMIT ${options.limit}
  `);

  if (rows.length === 0) return [];

  const matches = rows.map((r) => ({
    cardId: r.card_id,
    deckId: r.deck_id,
    similarity: 1.0, // exact text match
  }));

  return enrichResults(matches);
}

// ── Shared enrichment ────────────────────────────────────────────────────────

async function enrichResults(
  matches: { cardId: string; deckId: string; similarity: number }[],
): Promise<SearchResult[]> {
  const cardIds = matches.map((m) => m.cardId);
  const deckIds = [...new Set(matches.map((m) => m.deckId))];

  // Parallel fetch: fields + deck names
  const [fieldRows, deckRows] = await Promise.all([
    db
      .select({
        cardId: cardFieldValues.cardId,
        fieldName: templateFields.name,
        fieldType: templateFields.fieldType,
        side: templateFields.side,
        sortOrder: templateFields.sortOrder,
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

  // Index by card and deck
  const fieldsByCard = new Map<string, typeof fieldRows>();
  for (const f of fieldRows) {
    const arr = fieldsByCard.get(f.cardId) ?? [];
    arr.push(f);
    fieldsByCard.set(f.cardId, arr);
  }

  const deckNameMap = new Map(deckRows.map((d) => [d.id, d.name]));

  // Build results preserving similarity order
  return matches.map((m) => ({
    cardId: m.cardId,
    deckId: m.deckId,
    deckName: deckNameMap.get(m.deckId) ?? '',
    similarity: m.similarity,
    fields: (fieldsByCard.get(m.cardId) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((f) => ({
        fieldName: f.fieldName,
        fieldType: f.fieldType,
        side: f.side,
        value: f.value,
      })),
  }));
}
