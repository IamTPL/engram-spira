import { eq, and, lte, inArray, isNull, or, sql, gte, desc } from 'drizzle-orm';
import { db, pgClient } from '../../db';
import {
  studyProgress,
  studyDailyLogs,
  cards,
  decks,
} from '../../db/schema';
import { ValidationError } from '../../shared/errors';
import { STREAK } from '../../shared/constants';
import * as notificationsService from '../notifications/notifications.service';
import { MAX_STUDY_CLUSTER_CARDS } from './study-cluster';
import {
  createPostgresFsrsDeckReadRepository,
  type FsrsDeckReadRepository,
} from './fsrs-deck-reads.postgres';
import { createFsrsLiveService } from './fsrs-live.service';
import { createPostgresFsrsLiveRepository } from './fsrs-live.postgres';

/** Canonical FSRS write path: reviews, resets, parameter rotation. */
export const fsrsLiveService = createFsrsLiveService(
  createPostgresFsrsLiveRepository(pgClient),
);

const defaultFsrsDeckReadRepository =
  createPostgresFsrsDeckReadRepository(pgClient);

export function createStudyDeckReadService(
  repository: FsrsDeckReadRepository = defaultFsrsDeckReadRepository,
) {
  return {
    async getDueCards(
      deckId: string,
      userId: string,
      reviewAll = false,
      selectedCardIds?: string[],
    ) {
      const requestedCardIds = selectedCardIds
        ? Array.from(new Set(selectedCardIds))
        : undefined;
      if (
        requestedCardIds !== undefined &&
        requestedCardIds.length > MAX_STUDY_CLUSTER_CARDS
      ) {
        throw new ValidationError(
          `Study cluster cannot contain more than ${MAX_STUDY_CLUSTER_CARDS} cards`,
        );
      }
      const asOf = new Date();
      return repository.getDueCards({
        deckId,
        userId,
        reviewAll,
        selectedCardIds: requestedCardIds,
        asOf,
      });
    },

    getDeckSchedule(deckId: string, userId: string) {
      const asOf = new Date();
      return repository.getDeckSchedule({ deckId, userId, asOf });
    },
  };
}

const defaultStudyDeckReadService = createStudyDeckReadService();

/** Canonical card enrichment for all existing callers, including interleaved mode. */
async function enrichCards(
  targetIds: string[],
  userId: string,
  sortByCardOrder = true,
) {
  return defaultFsrsDeckReadRepository.enrichCards(
    targetIds,
    userId,
    new Date(),
    sortByCardOrder,
  );
}

export async function getDueCards(
  deckId: string,
  userId: string,
  reviewAll = false,
  selectedCardIds?: string[],
) {
  return defaultStudyDeckReadService.getDueCards(
    deckId,
    userId,
    reviewAll,
    selectedCardIds,
  );
}

export async function getDeckSchedule(deckId: string, userId: string) {
  return defaultStudyDeckReadService.getDeckSchedule(deckId, userId);
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
  const uniqueDeckIds =
    deckIds.length > 1 ? Array.from(new Set(deckIds)) : deckIds;

  const now = new Date();

  // Fetch due cards across all selected decks with urgency ordering
  // Urgency: overdue cards first (sorted by how overdue), then new cards
  const dueRows = await db
    .select({
      id: cards.id,
      deckId: cards.deckId,
    })
    .from(cards)
    .innerJoin(decks, and(eq(cards.deckId, decks.id), eq(decks.userId, userId)))
    .leftJoin(
      studyProgress,
      and(eq(studyProgress.cardId, cards.id), eq(studyProgress.userId, userId)),
    )
    .where(
      and(
        inArray(cards.deckId, uniqueDeckIds),
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

  const enrichedCards = await enrichCards(interleaved, userId, false);

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

