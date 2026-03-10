import { eq, and, lte, inArray, isNull, or, sql, gte, desc } from 'drizzle-orm';
import { db } from '../../db';
import {
  studyProgress,
  studyDailyLogs,
  cards,
  cardFieldValues,
  templateFields,
  decks,
  reviewLogs,
} from '../../db/schema';
import { NotFoundError } from '../../shared/errors';
import { calculateNextReview } from './srs.engine';
import { STREAK, type ReviewAction } from '../../shared/constants';
import * as notificationsService from '../notifications/notifications.service';

// --------------- Helpers ---------------

/**
 * Upsert today's study log for a user, incrementing cards_reviewed by `count`.
 * Uses a single SQL upsert to avoid race conditions.
 */
async function upsertDailyLog(
  executor: any,
  userId: string,
  count: number,
  tzOffset = 0,
) {
  const today = new Date(Date.now() - tzOffset * 60000)
    .toISOString()
    .slice(0, 10); // 'YYYY-MM-DD'
  await executor
    .insert(studyDailyLogs)
    .values({ userId, studyDate: today, cardsReviewed: count })
    .onConflictDoUpdate({
      target: [studyDailyLogs.userId, studyDailyLogs.studyDate],
      set: {
        cardsReviewed: sql`study_daily_logs.cards_reviewed + ${count}`,
      },
    });
}

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
  tzOffset = 0,
) {
  // Verify ownership + get current progress in parallel
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

  const now = new Date();

  // Compute elapsed days for logging
  const elapsedDays = currentProgress?.lastReviewedAt
    ? Math.max(
        0,
        Math.round(
          (now.getTime() - currentProgress.lastReviewedAt.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      )
    : 0;
  const prevIntervalDays = currentProgress?.intervalDays ?? 0;

  // Derive card state for review logging
  const prevBoxLevel = currentProgress?.boxLevel ?? 0;
  const cardState = !currentProgress
    ? 'new'
    : prevBoxLevel === 0
      ? 'relearning'
      : prevIntervalDays < 21
        ? 'learning'
        : 'review';

  const sm2 = calculateNextReview(action, {
    boxLevel: currentProgress?.boxLevel ?? 0,
    easeFactor: currentProgress?.easeFactor ?? 2.5,
    intervalDays: currentProgress?.intervalDays ?? 1,
  });
  const upsertSet = {
    boxLevel: sm2.boxLevel,
    easeFactor: sm2.easeFactor,
    intervalDays: sm2.intervalDays,
    nextReviewAt: sm2.nextReviewAt,
    lastReviewedAt: now,
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(studyProgress)
      .values({
        userId,
        cardId,
        ...upsertSet,
      } as typeof studyProgress.$inferInsert)
      .onConflictDoUpdate({
        target: [studyProgress.userId, studyProgress.cardId],
        set: upsertSet,
      });

    await upsertDailyLog(tx, userId, 1, tzOffset);

    await tx.insert(reviewLogs).values({
      userId,
      cardId,
      rating: action,
      state: cardState,
      elapsedDays,
      scheduledDays: prevIntervalDays,
    });
  });

  return {
    cardId,
    boxLevel: upsertSet.boxLevel,
    easeFactor: upsertSet.easeFactor,
    intervalDays: upsertSet.intervalDays,
    nextReviewAt: upsertSet.nextReviewAt,
  };
}

export async function reviewCardBatch(
  userId: string,
  items: { cardId: string; action: ReviewAction }[],
  tzOffset = 0,
) {
  if (items.length === 0) return { reviewed: 0 };

  const cardIds = items.map((i) => i.cardId);

  // Verify all cards belong to this user + fetch current progress in parallel
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

  const upsertValues: (typeof studyProgress.$inferInsert)[] = [];
  const logEntries: {
    userId: string;
    cardId: string;
    rating: string;
    state: string;
    elapsedDays: number;
    scheduledDays: number;
  }[] = [];

  for (const item of items) {
    if (!ownedIds.has(item.cardId)) continue;
    const prev = progressByCard.get(item.cardId);
    const prevIntervalDays = prev?.intervalDays ?? 0;

    const elapsedDays = prev?.lastReviewedAt
      ? Math.max(
          0,
          Math.round(
            (now.getTime() - prev.lastReviewedAt.getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : 0;

    const prevBoxLevel = prev?.boxLevel ?? 0;
    const cardState = !prev
      ? 'new'
      : prevBoxLevel === 0
        ? 'relearning'
        : prevIntervalDays < 21
          ? 'learning'
          : 'review';

    const sm2 = calculateNextReview(item.action, {
      boxLevel: prev?.boxLevel ?? 0,
      easeFactor: prev?.easeFactor ?? 2.5,
      intervalDays: prev?.intervalDays ?? 1,
    });
    upsertValues.push({
      userId,
      cardId: item.cardId,
      boxLevel: sm2.boxLevel,
      easeFactor: sm2.easeFactor,
      intervalDays: sm2.intervalDays,
      nextReviewAt: sm2.nextReviewAt,
      lastReviewedAt: now,
    });
    logEntries.push({
      userId,
      cardId: item.cardId,
      rating: item.action,
      state: cardState,
      elapsedDays,
      scheduledDays: prevIntervalDays,
    });
  }

  if (upsertValues.length === 0) return { reviewed: 0 };

  // Determine which columns to set on conflict
  const conflictSet = {
    boxLevel: sql`excluded.box_level`,
    easeFactor: sql`excluded.ease_factor`,
    intervalDays: sql`excluded.interval_days`,
    nextReviewAt: sql`excluded.next_review_at`,
    lastReviewedAt: sql`excluded.last_reviewed_at`,
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(studyProgress)
      .values(upsertValues)
      .onConflictDoUpdate({
        target: [studyProgress.userId, studyProgress.cardId],
        set: conflictSet,
      });

    await upsertDailyLog(tx, userId, upsertValues.length, tzOffset);

    if (logEntries.length > 0) {
      await tx.insert(reviewLogs).values(logEntries);
    }
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
  // "Learned" = graduated past learning phase (boxLevel > 0)
  const learnedCards = progress.filter((p) => p.boxLevel > 0).length;

  // Group future reviews by day offset
  const buckets = new Map<number, number>();
  let nextReviewDate: string | null = null;
  let nearestMs = Infinity;
  let dueSoon = 0; // cards due within 1 hour (learning/relearning cards)

  const ONE_HOUR_MS = 60 * 60 * 1000;
  const ONE_DAY_MS = 24 * ONE_HOUR_MS;

  for (const p of progress) {
    const reviewTime = p.nextReviewAt.getTime();
    if (reviewTime <= now.getTime()) continue; // already due/overdue

    if (reviewTime < nearestMs) {
      nearestMs = reviewTime;
      nextReviewDate = p.nextReviewAt.toISOString();
    }

    const diffMs = reviewTime - now.getTime();

    // Cards due within 1 hour → "due soon" (Again/Hard learning cards)
    if (diffMs < ONE_HOUR_MS) {
      dueSoon++;
      continue;
    }

    // Round to nearest day so 23h59m → 1 (Tomorrow), not 0
    const diffDays = Math.max(1, Math.round(diffMs / ONE_DAY_MS));
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
    dueSoon,
    nextReviewDate,
  };
}

/**
 * Compute the user's current streak and longest streak.
 *
 * Algorithm: fetch all study dates sorted desc, walk backwards from today
 * to count consecutive days, then do a second pass for longest streak.
 */
export async function getUserStreak(userId: string, tzOffset = 0) {
  const scanFrom = new Date(Date.now() - tzOffset * 60000);
  scanFrom.setDate(scanFrom.getDate() - STREAK.ACTIVITY_MAX_DAYS);
  const scanFromDate = scanFrom.toISOString().slice(0, 10);

  const rows = await db
    .select({ studyDate: studyDailyLogs.studyDate })
    .from(studyDailyLogs)
    .where(
      and(
        eq(studyDailyLogs.userId, userId),
        gte(studyDailyLogs.studyDate, scanFromDate),
      ),
    )
    .orderBy(desc(studyDailyLogs.studyDate));

  if (rows.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      totalStudyDays: 0,
      studiedToday: false,
    };
  }

  // Build a set of study date strings for O(1) lookup
  const studyDates = new Set(rows.map((r) => r.studyDate));
  const today = new Date(Date.now() - tzOffset * 60000)
    .toISOString()
    .slice(0, 10);

  const studiedToday = studyDates.has(today);

  // Compute current streak backwards from today (or yesterday if not studied today)
  let currentStreak = 0;
  let checkDate = new Date(Date.now() - tzOffset * 60000);
  if (!studiedToday) {
    // If didn't study today, streak is still valid as long as yesterday was studied
    checkDate.setDate(checkDate.getDate() - 1);
  }

  while (true) {
    const dateStr = checkDate.toISOString().slice(0, 10);
    if (!studyDates.has(dateStr)) break;
    currentStreak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  // Compute longest streak (slide through all dates)
  const sortedDates = Array.from(studyDates).sort();
  let longestStreak = 0;
  let runLength = 1;

  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(sortedDates[i - 1]!);
    const curr = new Date(sortedDates[i]!);
    const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays === 1) {
      runLength++;
    } else {
      longestStreak = Math.max(longestStreak, runLength);
      runLength = 1;
    }
  }
  longestStreak = Math.max(longestStreak, runLength);

  return {
    currentStreak,
    longestStreak,
    totalStudyDays: studyDates.size,
    studiedToday,
  };
}

/**
 * Fetch daily activity logs for heatmap display.
 * Returns an array of { date, cardsReviewed } for the last `days` days.
 */
export async function getUserActivity(
  userId: string,
  days: number,
  tzOffset = 0,
) {
  const clampedDays = Math.min(days, STREAK.ACTIVITY_MAX_DAYS);
  const fromDate = new Date(Date.now() - tzOffset * 60000);
  fromDate.setDate(fromDate.getDate() - clampedDays + 1);
  const fromDateStr = fromDate.toISOString().slice(0, 10);

  const rows = await db
    .select({
      studyDate: studyDailyLogs.studyDate,
      cardsReviewed: studyDailyLogs.cardsReviewed,
    })
    .from(studyDailyLogs)
    .where(
      and(
        eq(studyDailyLogs.userId, userId),
        gte(studyDailyLogs.studyDate, fromDateStr),
      ),
    )
    .orderBy(studyDailyLogs.studyDate);

  return { activity: rows, days: clampedDays };
}

/**
 * Get global stats for a user:
 * - totalCardsReviewed all time
 * - totalStudySessions (distinct days)
 */
export async function getUserStats(userId: string) {
  const [row] = await db
    .select({
      totalCardsReviewed: sql<number>`COALESCE(SUM(cards_reviewed), 0)::int`,
      totalStudyDays: sql<number>`COUNT(*)::int`,
    })
    .from(studyDailyLogs)
    .where(eq(studyDailyLogs.userId, userId));

  return {
    totalCardsReviewed: row?.totalCardsReviewed ?? 0,
    totalStudyDays: row?.totalStudyDays ?? 0,
  };
}

export async function getDashboardSnapshot(userId: string, tzOffset = 0) {
  const [streak, activity, stats, dueDecks] = await Promise.all([
    getUserStreak(userId, tzOffset),
    getUserActivity(userId, 91, tzOffset),
    getUserStats(userId),
    notificationsService.getDueDecks(userId),
  ]);

  return {
    streak,
    activity: activity.activity,
    stats,
    dueDecks,
  };
}

// =====================================================================
// Interleaved Practice Mode
// =====================================================================

/**
 * Get due cards from multiple decks, interleaved with urgency-weighted
 * round-robin. Cards closer to being overdue are prioritized.
 */
export async function getInterleavedDueCards(
  userId: string,
  deckIds: string[],
  limit: number = 50,
) {
  if (deckIds.length === 0) return { cards: [], total: 0, due: 0 };

  // Verify all decks belong to user
  const ownedDecks = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.userId, userId), inArray(decks.id, deckIds)));
  const validIds = ownedDecks.map((d) => d.id);
  if (validIds.length === 0) return { cards: [], total: 0, due: 0 };

  const now = new Date();

  // Fetch due cards across all selected decks with urgency ordering
  // Urgency: overdue cards first (sorted by how overdue), then new cards
  const dueRows = await db
    .select({
      id: cards.id,
      deckId: cards.deckId,
      nextReviewAt: studyProgress.nextReviewAt,
    })
    .from(cards)
    .leftJoin(
      studyProgress,
      and(eq(studyProgress.cardId, cards.id), eq(studyProgress.userId, userId)),
    )
    .where(
      and(
        inArray(cards.deckId, validIds),
        or(isNull(studyProgress.id), lte(studyProgress.nextReviewAt, now)),
      ),
    )
    .orderBy(
      // NULL (new cards) → sort after overdue; overdue → earliest first
      sql`COALESCE(${studyProgress.nextReviewAt}, NOW() + interval '1 hour') ASC`,
    )
    .limit(limit * 2); // Fetch extra for round-robin

  if (dueRows.length === 0) return { cards: [], total: 0, due: 0 };

  // Round-robin interleave by deck
  const byDeck = new Map<string, typeof dueRows>();
  for (const row of dueRows) {
    const bucket = byDeck.get(row.deckId) ?? [];
    bucket.push(row);
    byDeck.set(row.deckId, bucket);
  }

  const interleaved: string[] = [];
  const deckBuckets = Array.from(byDeck.values());
  const indices = new Array(deckBuckets.length).fill(0);
  let added = 0;

  while (added < limit) {
    let anyAdded = false;
    for (let i = 0; i < deckBuckets.length && added < limit; i++) {
      if (indices[i] < deckBuckets[i].length) {
        interleaved.push(deckBuckets[i][indices[i]].id);
        indices[i]++;
        added++;
        anyAdded = true;
      }
    }
    if (!anyAdded) break;
  }

  const enrichedCards = await enrichCards(interleaved, userId);

  // Preserve interleaved order
  const orderMap = new Map(interleaved.map((id, idx) => [id, idx]));
  enrichedCards.sort(
    (a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0),
  );

  return {
    cards: enrichedCards,
    total: dueRows.length,
    due: interleaved.length,
  };
}

/**
 * Auto-select top N decks by due count and return interleaved cards.
 */
export async function getAutoInterleavedCards(
  userId: string,
  topN: number = 5,
  limit: number = 50,
) {
  const now = new Date();

  // Find decks with most due cards
  const deckDueCounts = await db
    .select({
      deckId: cards.deckId,
      dueCount: sql<number>`count(*)::int`,
    })
    .from(cards)
    .innerJoin(decks, and(eq(cards.deckId, decks.id), eq(decks.userId, userId)))
    .leftJoin(
      studyProgress,
      and(eq(studyProgress.cardId, cards.id), eq(studyProgress.userId, userId)),
    )
    .where(or(isNull(studyProgress.id), lte(studyProgress.nextReviewAt, now)))
    .groupBy(cards.deckId)
    .orderBy(sql`count(*) DESC`)
    .limit(topN);

  if (deckDueCounts.length === 0)
    return { cards: [], total: 0, due: 0, deckIds: [] };

  const deckIds = deckDueCounts.map((d) => d.deckId);
  const result = await getInterleavedDueCards(userId, deckIds, limit);

  return { ...result, deckIds };
}

// =====================================================================
// Reset Progress
// =====================================================================

/**
 * Reset all study progress for a deck — deletes study_progress rows,
 * effectively making all cards "new" again.
 */
export async function resetDeckProgress(deckId: string, userId: string) {
  await verifyDeckOwnership(deckId, userId);

  const deckCardIds = await db
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.deckId, deckId));

  if (deckCardIds.length === 0) return { reset: 0 };

  const ids = deckCardIds.map((c) => c.id);
  await db
    .delete(studyProgress)
    .where(
      and(eq(studyProgress.userId, userId), inArray(studyProgress.cardId, ids)),
    );

  return { reset: ids.length };
}

/**
 * Reset study progress for a single card.
 */
export async function resetCardProgress(cardId: string, userId: string) {
  // Verify ownership
  const [cardResult] = await db
    .select({ id: cards.id })
    .from(cards)
    .innerJoin(decks, and(eq(cards.deckId, decks.id), eq(decks.userId, userId)))
    .where(eq(cards.id, cardId))
    .limit(1);

  if (!cardResult) throw new NotFoundError('Card');

  await db
    .delete(studyProgress)
    .where(
      and(eq(studyProgress.userId, userId), eq(studyProgress.cardId, cardId)),
    );

  return { reset: true };
}
