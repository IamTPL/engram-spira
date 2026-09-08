import type { TransactionSql } from 'postgres';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { MAX_STUDY_CLUSTER_CARDS } from './study-cluster';
import { canonicalUuid } from './fsrs-live.domain';
import {
  bindTimestamp,
  timestampFromRow,
  type PgTimestamp,
} from '../../db/pg-codecs';
import {
  createPostgresCanonicalFsrsReadLoader,
  type CanonicalFsrsReadLoader,
} from './fsrs-read.postgres';
import {
  calculateCanonicalFsrsRetrievability,
  type CanonicalFsrsRead,
  type PersistedFsrsReadState,
} from './fsrs-retention';

type Queryable = Pick<TransactionSql, 'unsafe'>;

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export interface FsrsProgress {
  state: PersistedFsrsReadState;
  stability: number;
  difficulty: number;
  retrievability: number;
  nextReviewAt: string;
  lastReviewedAt: string;
  scheduledDays: number;
  reps: number;
  lapses: number;
  learningCycle: number;
}

export interface StudyCardField {
  cardId: string;
  templateFieldId: string;
  fieldName: string;
  fieldType: string;
  side: string;
  sortOrder: number;
  value: unknown;
}

export interface EnrichedStudyCard {
  id: string;
  deckId: string;
  sortOrder: number;
  createdAt: Date;
  fields: StudyCardField[];
  progress: FsrsProgress | null;
}

export interface GetDueCardsInput {
  deckId: string;
  userId: string;
  reviewAll: boolean;
  selectedCardIds?: readonly string[];
  asOf: Date;
}

export interface GetDeckScheduleInput {
  deckId: string;
  userId: string;
  asOf: Date;
}

export interface DeckSchedule {
  totalCards: number;
  learnedCards: number;
  upcoming: Array<{
    daysFromNow: number;
    count: number;
    date: string;
  }>;
  dueSoon: number;
  nextReviewDate: string | null;
}

export interface FsrsDeckReadRepository {
  enrichCards(
    cardIds: readonly string[],
    userId: string,
    asOf: Date,
    sortByCardOrder?: boolean,
  ): Promise<EnrichedStudyCard[]>;
  getDueCards(input: GetDueCardsInput): Promise<{
    cards: EnrichedStudyCard[];
    total: number;
    due: number;
  }>;
  getDeckSchedule(input: GetDeckScheduleInput): Promise<DeckSchedule>;
  getInterleavedDueCards(input: {
    userId: string;
    deckIds: readonly string[];
    limit: number;
    asOf: Date;
  }): Promise<{ cards: EnrichedStudyCard[]; total: number; due: number }>;
  getTopDueDeckIds(input: {
    userId: string;
    topN: number;
    asOf: Date;
  }): Promise<string[]>;
}

interface CardFieldRow {
  cardId: string;
  deckId: string;
  cardSortOrder: number;
  createdAt: PgTimestamp;
  templateFieldId: string | null;
  fieldName: string | null;
  fieldType: string | null;
  side: string | null;
  fieldSortOrder: number | null;
  value: unknown | null;
}

/**
 * The principal owned-deck queue query. Card-id tie breaking is deliberate:
 * `idx_cards_deck_sort_order` orders the common case and ties remain stable.
 */
export const DUE_CARD_IDS_SQL = `
  SELECT cards.id::text AS id
  FROM cards
  LEFT JOIN fsrs_card_states AS state
    ON state.card_id = cards.id
   AND state.user_id = $2::uuid
  WHERE cards.deck_id = $1::uuid
    AND (state.id IS NULL OR state.next_review_at <= $3::timestamptz)
  ORDER BY cards.sort_order, cards.id`;

export function createPostgresFsrsDeckReadRepository(
  sql: Queryable,
  canonicalLoader: CanonicalFsrsReadLoader =
    createPostgresCanonicalFsrsReadLoader(sql),
): FsrsDeckReadRepository {
  return {
    enrichCards(cardIds, userId, asOf, sortByCardOrder = true) {
      return enrichCards(sql, canonicalLoader, cardIds, userId, asOf, sortByCardOrder);
    },

    async getDueCards(input) {
      const userId = canonicalUuid(input.userId, 'User id');
      const deckId = canonicalUuid(input.deckId, 'Deck id');
      const asOf = validAsOf(input.asOf);
      await requireOwnedDeck(sql, deckId, userId);

      if (input.selectedCardIds !== undefined) {
        const selectedCardIds = uniqueCardIds(input.selectedCardIds);
        if (selectedCardIds.length > MAX_STUDY_CLUSTER_CARDS) {
          throw new ValidationError(
            `Study cluster cannot contain more than ${MAX_STUDY_CLUSTER_CARDS} cards`,
          );
        }
        if (selectedCardIds.length === 0) {
          return { cards: [], total: 0, due: 0 };
        }
        await requireDeckCards(sql, deckId, selectedCardIds);
        const cards = await enrichCards(
          sql,
          canonicalLoader,
          selectedCardIds,
          userId,
          asOf,
          false,
        );
        return {
          cards,
          total: selectedCardIds.length,
          due: selectedCardIds.length,
        };
      }

      const [totalRows, dueRows] = await Promise.all([
        sql.unsafe<{ count: number }[]>(
          `SELECT COUNT(*)::int AS count
           FROM cards
           WHERE deck_id = $1::uuid`,
          [deckId],
        ),
        input.reviewAll
          ? sql.unsafe<{ id: string }[]>(
              `SELECT id::text AS id
               FROM cards
               WHERE deck_id = $1::uuid
               ORDER BY sort_order, id`,
              [deckId],
            )
          : sql.unsafe<{ id: string }[]>(DUE_CARD_IDS_SQL, [
              deckId,
              userId,
              bindTimestamp(asOf),
            ]),
      ]);

      const total = totalRows[0]?.count ?? 0;
      if (total === 0) return { cards: [], total: 0, due: 0 };
      const targetIds = dueRows.map((row) => row.id);
      if (targetIds.length === 0) return { cards: [], total, due: 0 };

      const cards = await enrichCards(
        sql,
        canonicalLoader,
        targetIds,
        userId,
        asOf,
        true,
      );
      return { cards, total, due: targetIds.length };
    },

    async getDeckSchedule(input) {
      const userId = canonicalUuid(input.userId, 'User id');
      const deckId = canonicalUuid(input.deckId, 'Deck id');
      const asOf = validAsOf(input.asOf);
      await requireOwnedDeck(sql, deckId, userId);

      const cardRows = await sql.unsafe<{ id: string }[]>(
        `SELECT id::text AS id
         FROM cards
         WHERE deck_id = $1::uuid
         ORDER BY sort_order, id`,
        [deckId],
      );
      if (cardRows.length === 0) {
        return {
          totalCards: 0,
          learnedCards: 0,
          upcoming: [],
          dueSoon: 0,
          nextReviewDate: null,
        };
      }

      const reads = await canonicalLoader.loadByCardIds(
        userId,
        cardRows.map((card) => card.id),
      );
      return scheduleFromReads(reads.map((item) => item.read), asOf);
    },

    async getInterleavedDueCards(input) {
      const userId = canonicalUuid(input.userId, 'User id');
      const deckIds = Array.from(
        new Set(input.deckIds.map((id) => canonicalUuid(id, 'Deck id'))),
      );
      const asOf = validAsOf(input.asOf);
      const limit = Math.max(1, Math.min(200, Math.trunc(input.limit)));
      if (deckIds.length === 0) return { cards: [], total: 0, due: 0 };

      // `deck_rank` preserves the caller's `deckIds` order for round-robin
      // interleaving; ordering by `deck_id` text instead would make the
      // sequence depend on random UUID lexicographic order.
      const rows = await sql.unsafe<{ id: string; total: number }[]>(
        `WITH requested AS (
           SELECT deck_id, ord
           FROM unnest($2::uuid[]) WITH ORDINALITY AS t(deck_id, ord)
         ),
         due AS (
           SELECT
             c.id,
             r.ord AS deck_rank,
             ROW_NUMBER() OVER (
               PARTITION BY c.deck_id
               ORDER BY s.next_review_at NULLS LAST, c.sort_order, c.id
             ) AS rn
           FROM cards c
           JOIN requested r ON r.deck_id = c.deck_id
           JOIN decks d ON d.id = c.deck_id AND d.user_id = $1::uuid
           LEFT JOIN fsrs_card_states s
             ON s.card_id = c.id AND s.user_id = $1::uuid
           WHERE s.id IS NULL OR s.next_review_at <= $3::timestamptz
         )
         SELECT id::text AS id, COUNT(*) OVER ()::int AS total
         FROM due
         ORDER BY rn, deck_rank, id
         LIMIT $4::int`,
        [userId, deckIds, bindTimestamp(asOf), limit],
      );
      if (rows.length === 0) return { cards: [], total: 0, due: 0 };
      const ids = rows.map((row) => row.id);
      const cards = await enrichCards(sql, canonicalLoader, ids, userId, asOf, false);
      return { cards, total: rows[0]!.total, due: ids.length };
    },

    async getTopDueDeckIds(input) {
      const userId = canonicalUuid(input.userId, 'User id');
      const asOf = validAsOf(input.asOf);
      const topN = Math.max(1, Math.min(50, Math.trunc(input.topN)));
      // Tie-break by deck creation order (oldest first), not by deck_id
      // text — a raw UUID tie-break would make the result depend on random
      // UUID lexicographic order instead of a stable, meaningful order.
      const rows = await sql.unsafe<{ deckId: string }[]>(
        `SELECT c.deck_id::text AS "deckId"
         FROM cards c
         JOIN decks d ON d.id = c.deck_id AND d.user_id = $1::uuid
         LEFT JOIN fsrs_card_states s
           ON s.card_id = c.id AND s.user_id = $1::uuid
         WHERE s.id IS NULL OR s.next_review_at <= $2::timestamptz
         GROUP BY c.deck_id, d.created_at
         ORDER BY COUNT(*) DESC, d.created_at, c.deck_id
         LIMIT $3::int`,
        [userId, bindTimestamp(asOf), topN],
      );
      return rows.map((row) => row.deckId);
    },
  };
}

async function enrichCards(
  sql: Queryable,
  canonicalLoader: CanonicalFsrsReadLoader,
  targetIds: readonly string[],
  userId: string,
  asOf: Date,
  sortByCardOrder: boolean,
): Promise<EnrichedStudyCard[]> {
  const canonicalUserId = canonicalUuid(userId, 'User id');
  const cardIds = uniqueCardIds(targetIds);
  const canonicalAsOf = validAsOf(asOf);
  if (cardIds.length === 0) return [];

  const [fieldRows, reads] = await Promise.all([
    sql.unsafe<CardFieldRow[]>(
      `SELECT
         cards.id::text AS "cardId",
         cards.deck_id::text AS "deckId",
         cards.sort_order AS "cardSortOrder",
         cards.created_at AS "createdAt",
         card_field_values.template_field_id::text AS "templateFieldId",
         template_fields.name AS "fieldName",
         template_fields.field_type AS "fieldType",
         template_fields.side,
         template_fields.sort_order AS "fieldSortOrder",
         card_field_values.value
       FROM cards
       LEFT JOIN card_field_values
         ON card_field_values.card_id = cards.id
       LEFT JOIN template_fields
         ON template_fields.id = card_field_values.template_field_id
       WHERE cards.id = ANY($1::uuid[])
       ORDER BY cards.sort_order, cards.id, template_fields.sort_order, template_fields.id`,
      [cardIds],
    ),
    canonicalLoader.loadByCardIds(canonicalUserId, cardIds),
  ]);

  const cardsById = new Map<string, EnrichedStudyCard>();
  for (const row of fieldRows) {
    const existing = cardsById.get(row.cardId);
    const card = existing ?? {
      id: row.cardId,
      deckId: row.deckId,
      sortOrder: row.cardSortOrder,
      createdAt: timestampFromRow(row.createdAt, 'Card createdAt'),
      fields: [],
      progress: null,
    };
    if (!existing) cardsById.set(row.cardId, card);
    if (
      row.templateFieldId !== null &&
      row.fieldName !== null &&
      row.fieldType !== null &&
      row.side !== null &&
      row.fieldSortOrder !== null
    ) {
      card.fields.push({
        cardId: row.cardId,
        templateFieldId: row.templateFieldId,
        fieldName: row.fieldName,
        fieldType: row.fieldType,
        side: row.side,
        sortOrder: row.fieldSortOrder,
        value: row.value,
      });
    }
  }

  for (const item of reads) {
    const card = cardsById.get(item.cardId);
    if (!card) {
      throw new ValidationError(
        'Canonical FSRS read returned a card missing from field enrichment',
      );
    }
    card.progress = progressFromRead(item.read, canonicalAsOf);
    card.fields.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.templateFieldId.localeCompare(right.templateFieldId),
    );
  }

  const enriched = cardIds.map((cardId) => {
    const card = cardsById.get(cardId);
    if (!card) {
      throw new ValidationError('Card field enrichment returned an incomplete set');
    }
    return card;
  });
  if (!sortByCardOrder) return enriched;
  return enriched.sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
}

function progressFromRead(
  read: CanonicalFsrsRead | null,
  asOf: Date,
): FsrsProgress | null {
  if (read === null) return null;
  const retrievability = calculateCanonicalFsrsRetrievability(read, asOf);
  if (retrievability === null) {
    throw new ValidationError('Canonical FSRS state must have retrievability');
  }
  const state = read.state;
  return {
    state: state.state,
    stability: state.stability,
    difficulty: state.difficulty,
    retrievability,
    nextReviewAt: state.nextReviewAt.toISOString(),
    lastReviewedAt: state.lastReviewedAt.toISOString(),
    scheduledDays: state.scheduledDays,
    reps: state.reps,
    lapses: state.lapses,
    learningCycle: state.learningCycle,
  };
}

function scheduleFromReads(
  reads: Array<CanonicalFsrsRead | null>,
  asOf: Date,
): DeckSchedule {
  const asOfMs = asOf.getTime();
  const buckets = new Map<number, number>();
  let learnedCards = 0;
  let dueSoon = 0;
  let nearestMs = Infinity;
  let nextReviewDate: string | null = null;

  for (const read of reads) {
    if (read === null) continue;
    const state = read.state;
    if (state.state === 'review') learnedCards++;
    const reviewTime = state.nextReviewAt.getTime();
    if (reviewTime <= asOfMs) continue;
    if (reviewTime < nearestMs) {
      nearestMs = reviewTime;
      nextReviewDate = state.nextReviewAt.toISOString();
    }

    const diffMs = reviewTime - asOfMs;
    if (diffMs < ONE_HOUR_MS) {
      dueSoon++;
      continue;
    }
    const diffDays = Math.max(1, Math.round(diffMs / ONE_DAY_MS));
    buckets.set(diffDays, (buckets.get(diffDays) ?? 0) + 1);
  }

  return {
    totalCards: reads.length,
    learnedCards,
    upcoming: Array.from(buckets.entries())
      .sort(([left], [right]) => left - right)
      .map(([daysFromNow, count]) => ({
        daysFromNow,
        count,
        date: new Date(asOfMs + daysFromNow * ONE_DAY_MS).toISOString(),
      })),
    dueSoon,
    nextReviewDate,
  };
}

async function requireOwnedDeck(
  sql: Queryable,
  deckId: string,
  userId: string,
) {
  const rows = await sql.unsafe<{ id: string }[]>(
    `SELECT id::text AS id
     FROM decks
     WHERE id = $1::uuid AND user_id = $2::uuid
     LIMIT 1`,
    [deckId, userId],
  );
  if (rows.length === 0) throw new NotFoundError('Deck');
}

async function requireDeckCards(
  sql: Queryable,
  deckId: string,
  cardIds: readonly string[],
) {
  const rows = await sql.unsafe<{ id: string }[]>(
    `SELECT id::text AS id
     FROM cards
     WHERE deck_id = $1::uuid
       AND id = ANY($2::uuid[])`,
    [deckId, cardIds],
  );
  if (rows.length !== cardIds.length) throw new NotFoundError('Card');
}

function uniqueCardIds(cardIds: readonly string[]): string[] {
  if (!Array.isArray(cardIds)) {
    throw new ValidationError('Card ids must be an array');
  }
  const unique = new Set<string>();
  for (const [index, cardId] of cardIds.entries()) {
    unique.add(canonicalUuid(cardId, `Card id ${index + 1}`));
  }
  return Array.from(unique);
}

function validAsOf(asOf: Date): Date {
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) {
    throw new ValidationError('asOf must be a valid Date');
  }
  return new Date(asOf.getTime());
}
