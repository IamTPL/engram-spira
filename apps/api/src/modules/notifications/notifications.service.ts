import { eq, and, lte, isNull, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { cards, decks, studyProgress } from '../../db/schema';
import { NOTIFICATIONS } from '../../shared/constants';

export interface DueDeckNotification {
  deckId: string;
  deckName: string;
  dueCount: number;
}

/**
 * Returns all decks owned by the user that have at least one due card.
 * "Due" = study_progress.next_review_at <= NOW() OR no progress record yet.
 *
 * Uses decks.user_id (denormalized) for O(1) ownership — no JOIN chain needed.
 */
export async function getDueDecks(
  userId: string,
): Promise<DueDeckNotification[]> {
  const now = new Date();

  const rows = await db
    .select({
      deckId: decks.id,
      deckName: decks.name,
      dueCount: sql<number>`count(${cards.id})::int`,
    })
    .from(cards)
    .innerJoin(decks, eq(cards.deckId, decks.id))
    .leftJoin(
      studyProgress,
      and(eq(studyProgress.cardId, cards.id), eq(studyProgress.userId, userId)),
    )
    .where(
      and(
        eq(decks.userId, userId),
        or(isNull(studyProgress.id), lte(studyProgress.nextReviewAt, now)),
      ),
    )
    .groupBy(decks.id, decks.name)
    .orderBy(sql`count(${cards.id}) DESC`)
    .limit(NOTIFICATIONS.MAX_DUE_DECKS);

  return rows.map((r) => ({
    deckId: r.deckId,
    deckName: r.deckName,
    dueCount: r.dueCount,
  }));
}

/** Total count of all due cards across all decks for badge display. */
export async function getTotalDueCount(userId: string): Promise<number> {
  const now = new Date();

  const [row] = await db
    .select({ total: sql<number>`count(${cards.id})::int` })
    .from(cards)
    .innerJoin(decks, eq(cards.deckId, decks.id))
    .leftJoin(
      studyProgress,
      and(eq(studyProgress.cardId, cards.id), eq(studyProgress.userId, userId)),
    )
    .where(
      and(
        eq(decks.userId, userId),
        or(isNull(studyProgress.id), lte(studyProgress.nextReviewAt, now)),
      ),
    );

  return row?.total ?? 0;
}
