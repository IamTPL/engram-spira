import { and, eq, sql } from 'drizzle-orm';

import { db } from '../../db';
import { decks } from '../../db/schema';
import { NotFoundError } from '../../shared/errors';

const MIN_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 90;
const WORKLOAD_DAYS = 14;
const RECENT_REVIEW_LIMIT = 20;

export type RetentionReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface RetentionOutcomeBucketRow extends Record<string, unknown> {
  date: string;
  rating: string;
  count: number;
}

export interface RetentionWorkloadRow extends Record<string, unknown> {
  date: string;
  count: number;
}

export interface RetentionRecentReviewRow extends Record<string, unknown> {
  id: string;
  cardId: string;
  sortOrder: number;
  label: string | null;
  rating: string;
  reviewedAt: Date | string;
  elapsedDays: number;
  scheduledDays: number;
}

export interface RetentionDetailsLoaders {
  loadOwnedDeck(userId: string, deckId: string): Promise<boolean>;
  loadOutcomeBuckets(
    userId: string,
    deckId: string,
    from: Date,
    until: Date,
    tzOffset: number,
  ): Promise<RetentionOutcomeBucketRow[]>;
  loadWorkload(
    userId: string,
    deckId: string,
    asOf: Date,
    tzOffset: number,
  ): Promise<RetentionWorkloadRow[]>;
  loadRecentReviews(
    userId: string,
    deckId: string,
  ): Promise<RetentionRecentReviewRow[]>;
}

export interface RetentionDetailsResponse {
  asOf: string;
  rangeDays: number;
  outcomes: {
    total: number;
    recalled: number;
    recallRate: number | null;
    again: number;
    hard: number;
    good: number;
    easy: number;
  };
  dailyOutcomes: Array<{
    date: string;
    total: number;
    recalled: number;
  }>;
  workload: RetentionWorkloadRow[];
  recentReviews: Array<{
    id: string;
    cardId: string;
    label: string;
    rating: RetentionReviewRating;
    reviewedAt: string;
    elapsedDays: number;
    scheduledDays: number;
  }>;
}

export async function getRetentionDetails(
  userId: string,
  deckId: string,
  requestedRangeDays = 30,
  requestedTzOffset = 0,
  loaders: RetentionDetailsLoaders = defaultRetentionDetailsLoaders,
  asOf: Date = new Date(),
): Promise<RetentionDetailsResponse> {
  const rangeDays = clampInteger(
    requestedRangeDays,
    MIN_RANGE_DAYS,
    MAX_RANGE_DAYS,
    30,
  );
  const tzOffset = clampInteger(requestedTzOffset, -720, 840, 0);
  const from = localRangeStart(asOf, tzOffset, rangeDays);

  const [owned, outcomeRows, workloadRows, recentRows] = await Promise.all([
    loaders.loadOwnedDeck(userId, deckId),
    loaders.loadOutcomeBuckets(userId, deckId, from, asOf, tzOffset),
    loaders.loadWorkload(userId, deckId, asOf, tzOffset),
    loaders.loadRecentReviews(userId, deckId),
  ]);
  if (!owned) throw new NotFoundError('Deck');

  const outcomes = summarizeOutcomes(outcomeRows);

  return {
    asOf: asOf.toISOString(),
    rangeDays,
    outcomes: outcomes.summary,
    dailyOutcomes: outcomes.daily,
    workload: buildWorkload(workloadRows, asOf, tzOffset),
    recentReviews: sanitizeRecentReviews(recentRows),
  };
}

export const defaultRetentionDetailsLoaders: RetentionDetailsLoaders = {
  async loadOwnedDeck(userId, deckId) {
    const [row] = await db
      .select({ id: decks.id })
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
      .limit(1);
    return Boolean(row);
  },
  loadOutcomeBuckets(userId, deckId, from, until, tzOffset) {
    const fromIso = from.toISOString();
    const untilIso = until.toISOString();
    return db.execute<RetentionOutcomeBucketRow>(sql`
      SELECT
        (
          (rl.reviewed_at AT TIME ZONE 'UTC')
          - (${tzOffset}::integer * interval '1 minute')
        )::date::text AS date,
        rl.rating,
        COUNT(*)::int AS count
      FROM review_logs rl
      INNER JOIN cards c ON c.id = rl.card_id
      INNER JOIN decks d ON d.id = c.deck_id
      WHERE rl.user_id = ${userId}
        AND d.id = ${deckId}
        AND d.user_id = ${userId}
        AND rl.reviewed_at >= ${fromIso}::timestamptz
        AND rl.reviewed_at <= ${untilIso}::timestamptz
      GROUP BY date, rl.rating
      ORDER BY date ASC, rl.rating ASC
    `);
  },
  loadWorkload(userId, deckId, asOf, tzOffset) {
    const localToday = localDateKey(asOf, tzOffset);
    const upperBound = localDateStartToUtc(
      addDays(localToday, WORKLOAD_DAYS),
      tzOffset,
    ).toISOString();
    return db.execute<RetentionWorkloadRow>(sql`
      SELECT
        GREATEST(
          (
            (sp.next_review_at AT TIME ZONE 'UTC')
            - (${tzOffset}::integer * interval '1 minute')
          )::date,
          ${localToday}::date
        )::text AS date,
        COUNT(*)::int AS count
      FROM study_progress sp
      INNER JOIN cards c ON c.id = sp.card_id
      INNER JOIN decks d ON d.id = c.deck_id
      WHERE sp.user_id = ${userId}
        AND d.id = ${deckId}
        AND d.user_id = ${userId}
        AND sp.next_review_at < ${upperBound}::timestamptz
      GROUP BY date
      ORDER BY date ASC
    `);
  },
  loadRecentReviews(userId, deckId) {
    return db.execute<RetentionRecentReviewRow>(sql`
      WITH recent AS (
        SELECT
          rl.id,
          rl.card_id,
          c.sort_order,
          rl.rating,
          rl.reviewed_at,
          rl.elapsed_days,
          rl.scheduled_days
        FROM review_logs rl
        INNER JOIN cards c ON c.id = rl.card_id
        INNER JOIN decks d ON d.id = c.deck_id
        WHERE rl.user_id = ${userId}
          AND d.id = ${deckId}
          AND d.user_id = ${userId}
          AND rl.rating IN ('again', 'hard', 'good', 'easy')
        ORDER BY rl.reviewed_at DESC, rl.id DESC
        LIMIT ${RECENT_REVIEW_LIMIT}
      )
      SELECT
        recent.id,
        recent.card_id AS "cardId",
        recent.sort_order AS "sortOrder",
        label.value AS label,
        recent.rating,
        recent.reviewed_at AS "reviewedAt",
        recent.elapsed_days AS "elapsedDays",
        recent.scheduled_days AS "scheduledDays"
      FROM recent
      LEFT JOIN LATERAL (
        SELECT
          LEFT(
            COALESCE(cfv.value #>> '{text}', cfv.value #>> '{}'),
            80
          ) AS value
        FROM card_field_values cfv
        INNER JOIN template_fields tf ON tf.id = cfv.template_field_id
        WHERE cfv.card_id = recent.card_id
          AND tf.side = 'front'
        ORDER BY tf.sort_order ASC, tf.id ASC
        LIMIT 1
      ) label ON true
      ORDER BY recent.reviewed_at DESC, recent.id DESC
    `);
  },
};

function summarizeOutcomes(rows: RetentionOutcomeBucketRow[]): {
  summary: RetentionDetailsResponse['outcomes'];
  daily: RetentionDetailsResponse['dailyOutcomes'];
} {
  const totals: Record<RetentionReviewRating, number> = {
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
  };
  const byDate = new Map<
    string,
    Record<RetentionReviewRating, number>
  >();

  for (const row of rows) {
    if (!isReviewRating(row.rating) || !isDateKey(row.date)) continue;
    const count = nonNegativeInteger(row.count);
    if (count === 0) continue;
    totals[row.rating] += count;
    const daily = byDate.get(row.date) ?? {
      again: 0,
      hard: 0,
      good: 0,
      easy: 0,
    };
    daily[row.rating] += count;
    byDate.set(row.date, daily);
  }

  const recalled = totals.hard + totals.good + totals.easy;
  const total = totals.again + recalled;
  return {
    summary: {
      total,
      recalled,
      recallRate: total === 0 ? null : roundMetric(recalled / total),
      ...totals,
    },
    daily: [...byDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, daily]) => ({
        date,
        total: daily.again + daily.hard + daily.good + daily.easy,
        recalled: daily.hard + daily.good + daily.easy,
      })),
  };
}

function buildWorkload(
  rows: RetentionWorkloadRow[],
  asOf: Date,
  tzOffset: number,
): RetentionWorkloadRow[] {
  const startDate = localDateKey(asOf, tzOffset);
  const expectedDates = Array.from({ length: WORKLOAD_DAYS }, (_, index) =>
    addDays(startDate, index),
  );
  const expected = new Set(expectedDates);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!expected.has(row.date)) continue;
    counts.set(
      row.date,
      (counts.get(row.date) ?? 0) + nonNegativeInteger(row.count),
    );
  }
  return expectedDates.map((date) => ({
    date,
    count: counts.get(date) ?? 0,
  }));
}

function sanitizeRecentReviews(
  rows: RetentionRecentReviewRow[],
): RetentionDetailsResponse['recentReviews'] {
  return rows
    .flatMap((row) => {
      if (!isReviewRating(row.rating)) return [];
      const reviewedAt = toValidDate(row.reviewedAt);
      if (!reviewedAt) return [];
      const label = row.label?.trim();
      return [
        {
          id: row.id,
          cardId: row.cardId,
          label: label || `Card ${nonNegativeInteger(row.sortOrder) + 1}`,
          rating: row.rating,
          reviewedAt: reviewedAt.toISOString(),
          elapsedDays: nonNegativeInteger(row.elapsedDays),
          scheduledDays: nonNegativeInteger(row.scheduledDays),
        },
      ];
    })
    .sort((left, right) => {
      const dateDiff =
        Date.parse(right.reviewedAt) - Date.parse(left.reviewedAt);
      if (dateDiff !== 0) return dateDiff;
      return right.id.localeCompare(left.id);
    })
    .slice(0, RECENT_REVIEW_LIMIT);
}

function isReviewRating(value: string): value is RetentionReviewRating {
  return (
    value === 'again' ||
    value === 'hard' ||
    value === 'good' ||
    value === 'easy'
  );
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function localDateKey(date: Date, tzOffset: number): string {
  return new Date(date.getTime() - tzOffset * 60_000)
    .toISOString()
    .slice(0, 10);
}

function localRangeStart(
  asOf: Date,
  tzOffset: number,
  rangeDays: number,
): Date {
  const localToday = localDateKey(asOf, tzOffset);
  const firstDate = addDays(localToday, -(rangeDays - 1));
  return localDateStartToUtc(firstDate, tzOffset);
}

function localDateStartToUtc(date: string, tzOffset: number): Date {
  return new Date(
    Date.parse(`${date}T00:00:00.000Z`) + tzOffset * 60_000,
  );
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function toValidDate(value: Date | string): Date | null {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function clampInteger(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}
