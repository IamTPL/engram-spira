import { eq, and, lte, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  studyProgress,
  cards,
  cardFieldValues,
  templateFields,
  decks,
} from '../../db/schema';
import { NotFoundError } from '../../shared/errors';
import { calculateNextReview } from './srs.engine';
import type { ReviewAction } from '../../shared/constants';

// Ownership check: uses denormalized decks.userId — single index lookup, no JOIN chain
async function verifyDeckOwnership(deckId: string, userId: string) {
  const [result] = await db
    .select({ id: decks.id, cardTemplateId: decks.cardTemplateId })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
    .limit(1);
  if (!result) throw new NotFoundError('Deck');
  return result;
}

/** Helper to fetch and enrich a set of card IDs with their field values + progress */
async function enrichCards(targetIds: string[], userId: string) {
  const [targetCardsData, allFieldValues, progressRows] = await Promise.all([
    db
      .select()
      .from(cards)
      .where(inArray(cards.id, targetIds))
      .orderBy(cards.sortOrder),
    db
      .select({
        cardId: cardFieldValues.cardId,
        templateFieldId: cardFieldValues.templateFieldId,
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
      .where(inArray(cardFieldValues.cardId, targetIds)),
    db
      .select()
      .from(studyProgress)
      .where(
        and(
          eq(studyProgress.userId, userId),
          inArray(studyProgress.cardId, targetIds),
        ),
      ),
  ]);

  const fieldsByCard = new Map<string, typeof allFieldValues>();
  for (const fv of allFieldValues) {
    const existing = fieldsByCard.get(fv.cardId) ?? [];
    existing.push(fv);
    fieldsByCard.set(fv.cardId, existing);
  }
  const progressByCard = new Map(progressRows.map((p) => [p.cardId, p]));

  return targetCardsData.map((card) => ({
    ...card,
    fields: (fieldsByCard.get(card.id) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    ),
    progress: progressByCard.get(card.id) ?? null,
  }));
}

export async function getDueCards(
  deckId: string,
  userId: string,
  reviewAll = false,
) {
  await verifyDeckOwnership(deckId, userId);
  const now = new Date();

  // Run total count + due-card query in parallel (SQL-level filter instead of JS filter)
  const [[countRow], dueRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(cards)
      .where(eq(cards.deckId, deckId)),
    reviewAll
      ? // reviewAll: fetch all card IDs
        db
          .select({ id: cards.id })
          .from(cards)
          .where(eq(cards.deckId, deckId))
          .orderBy(cards.sortOrder)
      : // Normal mode: LEFT JOIN study_progress, filter due/new cards entirely in SQL
        db
          .select({ id: cards.id })
          .from(cards)
          .leftJoin(
            studyProgress,
            and(
              eq(studyProgress.cardId, cards.id),
              eq(studyProgress.userId, userId),
            ),
          )
          .where(
            and(
              eq(cards.deckId, deckId),
              or(
                isNull(studyProgress.id),
                lte(studyProgress.nextReviewAt, now),
              ),
            ),
          )
          .orderBy(cards.sortOrder),
  ]);

  const total = countRow?.count ?? 0;
  if (total === 0) return { cards: [], total: 0, due: 0 };

  const targetIds = dueRows.map((r) => r.id);
  if (targetIds.length === 0) return { cards: [], total, due: 0 };

  const enrichedCards = await enrichCards(targetIds, userId);
  return { cards: enrichedCards, total, due: targetIds.length };
}

export async function reviewCard(
  cardId: string,
  userId: string,
  action: ReviewAction,
) {
  // Verify ownership + get current progress in parallel
  // Card ownership: cards → decks.userId (single index, no JOIN chain)
  const [[cardResult], [currentProgress]] = await Promise.all([
    db
      .select({ id: cards.id })
      .from(cards)
      .innerJoin(
        decks,
        and(eq(cards.deckId, decks.id), eq(decks.userId, userId)),
      )
      .where(eq(cards.id, cardId))
      .limit(1),
    db
      .select()
      .from(studyProgress)
      .where(
        and(eq(studyProgress.userId, userId), eq(studyProgress.cardId, cardId)),
      )
      .limit(1),
  ]);

  if (!cardResult) throw new NotFoundError('Card');

  // Pass full SM-2 state so easeFactor and intervalDays are respected
  const { boxLevel, easeFactor, intervalDays, nextReviewAt } =
    calculateNextReview(action, {
      boxLevel: currentProgress?.boxLevel ?? 0,
      easeFactor: currentProgress?.easeFactor ?? 2.5,
      intervalDays: currentProgress?.intervalDays ?? 1,
    });
  const now = new Date();

  await db
    .insert(studyProgress)
    .values({
      userId,
      cardId,
      boxLevel,
      easeFactor,
      intervalDays,
      nextReviewAt,
      lastReviewedAt: now,
    })
    .onConflictDoUpdate({
      target: [studyProgress.userId, studyProgress.cardId],
      set: {
        boxLevel,
        easeFactor,
        intervalDays,
        nextReviewAt,
        lastReviewedAt: now,
      },
    });

  return { cardId, boxLevel, easeFactor, intervalDays, nextReviewAt };
}

export async function reviewCardBatch(
  userId: string,
  items: { cardId: string; action: ReviewAction }[],
) {
  if (items.length === 0) return { reviewed: 0 };

  const cardIds = items.map((i) => i.cardId);

  // Verify all cards belong to this user + fetch current progress in parallel
  // Via decks.userId (denormalized) — avoids folders/classes JOIN
  const [ownedCards, progressRows] = await Promise.all([
    db
      .select({ id: cards.id })
      .from(cards)
      .innerJoin(
        decks,
        and(eq(cards.deckId, decks.id), eq(decks.userId, userId)),
      )
      .where(inArray(cards.id, cardIds)),
    db
      .select()
      .from(studyProgress)
      .where(
        and(
          eq(studyProgress.userId, userId),
          inArray(studyProgress.cardId, cardIds),
        ),
      ),
  ]);

  const ownedIds = new Set(ownedCards.map((c) => c.id));
  const progressByCard = new Map(progressRows.map((p) => [p.cardId, p]));
  const now = new Date();

  // Compute new progress for each valid card
  const upsertValues = items
    .filter((item) => ownedIds.has(item.cardId))
    .map((item) => {
      const prev = progressByCard.get(item.cardId);
      const { boxLevel, easeFactor, intervalDays, nextReviewAt } =
        calculateNextReview(item.action, {
          boxLevel: prev?.boxLevel ?? 0,
          easeFactor: prev?.easeFactor ?? 2.5,
          intervalDays: prev?.intervalDays ?? 1,
        });
      return {
        userId,
        cardId: item.cardId,
        boxLevel,
        easeFactor,
        intervalDays,
        nextReviewAt,
        lastReviewedAt: now,
      };
    });

  if (upsertValues.length === 0) return { reviewed: 0 };

  // Single batch upsert for all cards
  await db
    .insert(studyProgress)
    .values(upsertValues)
    .onConflictDoUpdate({
      target: [studyProgress.userId, studyProgress.cardId],
      set: {
        boxLevel: sql`excluded.box_level`,
        easeFactor: sql`excluded.ease_factor`,
        intervalDays: sql`excluded.interval_days`,
        nextReviewAt: sql`excluded.next_review_at`,
        lastReviewedAt: sql`excluded.last_reviewed_at`,
      },
    });

  return { reviewed: upsertValues.length };
}

export async function getDeckSchedule(deckId: string, userId: string) {
  await verifyDeckOwnership(deckId, userId);
  const now = new Date();

  // Parallel fetch: cards + progress
  const [deckCards, allProgress] = await Promise.all([
    db.select({ id: cards.id }).from(cards).where(eq(cards.deckId, deckId)),
    db
      .select()
      .from(studyProgress)
      .innerJoin(cards, eq(studyProgress.cardId, cards.id))
      .where(and(eq(studyProgress.userId, userId), eq(cards.deckId, deckId))),
  ]);

  if (deckCards.length === 0) {
    return {
      totalCards: 0,
      learnedCards: 0,
      upcoming: [],
      nextReviewDate: null,
    };
  }

  const progress = allProgress.map((r) => r.study_progress);
  const learnedCards = progress.length;

  // Group future reviews by day offset
  const buckets = new Map<number, number>();
  let nextReviewDate: string | null = null;
  let nearestMs = Infinity;

  for (const p of progress) {
    const reviewTime = p.nextReviewAt.getTime();
    if (reviewTime <= now.getTime()) continue; // already due/overdue

    if (reviewTime < nearestMs) {
      nearestMs = reviewTime;
      nextReviewDate = p.nextReviewAt.toISOString();
    }

    const diffMs = reviewTime - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    // Skip cards due today (within 24 hours) from upcoming list
    // They should appear in the due cards list instead
    if (diffDays < 1) continue;

    buckets.set(diffDays, (buckets.get(diffDays) ?? 0) + 1);
  }

  const upcoming = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([daysFromNow, count]) => ({
      daysFromNow,
      count,
      date: new Date(
        now.getTime() + daysFromNow * 24 * 60 * 60 * 1000,
      ).toISOString(),
    }));

  return {
    totalCards: deckCards.length,
    learnedCards,
    upcoming,
    nextReviewDate,
  };
}
