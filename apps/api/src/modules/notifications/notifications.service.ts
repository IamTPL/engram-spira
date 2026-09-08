import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import { NOTIFICATIONS } from '../../shared/constants';
import { fsrsDue, fsrsStateJoin } from '../study/fsrs-sql';

export interface DueDeckNotification {
  deckId: string;
  deckName: string;
  dueCount: number;
}

/** Decks with at least one due card. Due = no state row, or next_review_at <= asOf. */
export function dueDecksSql(userId: string, asOf: Date, limit: number): SQL {
  return sql`
    SELECT d.id::text AS "deckId", d.name AS "deckName", COUNT(*)::int AS "dueCount"
    FROM cards c
    JOIN decks d ON d.id = c.deck_id AND d.user_id = ${userId}::uuid
    ${fsrsStateJoin(userId)}
    WHERE ${fsrsDue(asOf)}
    GROUP BY d.id, d.name
    ORDER BY "dueCount" DESC, d.name ASC
    LIMIT ${limit}`;
}

export function totalDueSql(userId: string, asOf: Date): SQL {
  return sql`
    SELECT COUNT(*)::int AS total
    FROM cards c
    JOIN decks d ON d.id = c.deck_id AND d.user_id = ${userId}::uuid
    ${fsrsStateJoin(userId)}
    WHERE ${fsrsDue(asOf)}`;
}

export async function getDueDecks(
  userId: string,
  asOf: Date = new Date(),
): Promise<DueDeckNotification[]> {
  const rows = await db.execute<{
    deckId: string;
    deckName: string;
    dueCount: number;
  }>(dueDecksSql(userId, asOf, NOTIFICATIONS.MAX_DUE_DECKS));
  return rows.map((row) => ({
    deckId: row.deckId,
    deckName: row.deckName,
    dueCount: row.dueCount,
  }));
}

export async function getTotalDueCount(
  userId: string,
  asOf: Date = new Date(),
): Promise<number> {
  const [row] = await db.execute<{ total: number }>(totalDueSql(userId, asOf));
  return row?.total ?? 0;
}
