import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';
import * as forecastService from '../study/forecast.service';
import {
  fsrsAsOf,
  fsrsAtRisk,
  fsrsRetrievability,
  fsrsStateJoin,
} from '../study/fsrs-sql';
import * as recommendationsService from '../study/recommendations.service';
import { aggregateResponse, resolveSection } from './aggregate.helpers';
import type {
  AggregateResponse,
  CommandCenterResponse,
  InsightsOverviewResponse,
  InsightsOverviewSections,
} from './experience.types';

export const AT_RISK_CARD_LIMIT = 20;

export type InsightsOverviewLoaders = {
  loadForecast: (userId: string) => Promise<InsightsOverviewResponse['forecast']>;
  loadWeakAreas: (userId: string) => Promise<InsightsOverviewResponse['weakAreas']>;
  loadAtRiskCards: (
    userId: string,
  ) => Promise<InsightsOverviewResponse['atRiskCards']>;
  loadHeatmap: (userId: string) => Promise<InsightsOverviewResponse['heatmap']>;
  loadTrends: (userId: string) => Promise<InsightsOverviewResponse['trends']>;
};

export async function getInsightsOverview(
  userId: string,
  loaders: InsightsOverviewLoaders = defaultInsightsOverviewLoaders,
): Promise<AggregateResponse<InsightsOverviewResponse, InsightsOverviewSections>> {
  const forecast = await resolveSection({
    load: () => loaders.loadForecast(userId),
    fallback: null,
    empty: (data) => data === null || data.days.length === 0,
  });
  const weakAreas = await resolveSection({
    load: () => loaders.loadWeakAreas(userId),
    fallback: [],
    empty: (data) => data.length === 0,
  });
  const atRiskCards = await resolveSection({
    load: () => loaders.loadAtRiskCards(userId),
    fallback: [],
    empty: (data) => data.length === 0,
  });
  const heatmap = await resolveSection({
    load: () => loaders.loadHeatmap(userId),
    fallback: null,
    empty: (data) => data === null || data.length === 0,
  });
  const trends = await resolveSection({
    load: () => loaders.loadTrends(userId),
    fallback: null,
    empty: (data) => data === null,
  });

  return aggregateResponse(
    {
      forecast: forecast.data,
      weakAreas: weakAreas.data,
      atRiskCards: atRiskCards.data,
      heatmap: heatmap.data,
      trends: trends.data,
    },
    {
      forecast: forecast.meta,
      weakAreas: weakAreas.meta,
      atRiskCards: atRiskCards.meta,
      heatmap: heatmap.meta,
      trends: trends.meta,
    } satisfies InsightsOverviewSections,
  );
}

export const defaultInsightsOverviewLoaders: InsightsOverviewLoaders = {
  loadForecast,
  loadWeakAreas,
  loadAtRiskCards,
  loadHeatmap,
  loadTrends,
};

async function loadForecast(userId: string) {
  const { forecast } = await forecastService.getForecast(userId, 14);
  return {
    days: forecast.map((day) => ({
      date: day.date,
      atRiskCount: day.atRiskCount,
      avgRetention: day.avgRetention,
    })),
  };
}

async function loadWeakAreas(userId: string) {
  const { groups } = await recommendationsService.getSmartGroups(userId, 8);
  return groups.map((group) => ({
    id: `concept:${group.name}`,
    label: group.name,
    cardCount: group.cardCount,
    avgRetention: group.avgRetention,
    action: {
      id: 'study.smart-group',
      label: `Review ${group.name}`,
      params: { smartGroupId: group.name },
    },
  })) satisfies CommandCenterResponse['weakAreas'];
}

/** Cards whose canonical retrievability has already fallen below their target retention. */
export function atRiskCardsSql(userId: string, asOf: Date, limit: number): SQL {
  return sql`
    SELECT
      c.id::text AS id,
      c.deck_id::text AS "deckId",
      MIN(CASE WHEN tf.side = 'front' THEN cfv.value #>> '{}' END) AS title,
      ${fsrsRetrievability(asOf)}::real AS "retentionEstimate"
    FROM cards c
    JOIN decks d ON d.id = c.deck_id AND d.user_id = ${userId}::uuid
    ${fsrsStateJoin(userId)}
    LEFT JOIN card_field_values cfv ON cfv.card_id = c.id
    LEFT JOIN template_fields tf ON tf.id = cfv.template_field_id
    WHERE ${fsrsAtRisk(asOf)}
    GROUP BY c.id, c.deck_id, s.id, s.stability, s.last_reviewed_at, r.decay, r.factor
    ORDER BY "retentionEstimate" ASC, c.id ASC
    LIMIT ${limit}`;
}

async function loadAtRiskCards(userId: string, asOf = new Date()) {
  const rows = await db.execute<{
    id: string;
    deckId: string;
    title: string | null;
    retentionEstimate: number | null;
  }>(atRiskCardsSql(userId, asOf, AT_RISK_CARD_LIMIT));

  return rows.map((row) => ({
    id: row.id,
    deckId: row.deckId,
    title: row.title ?? '',
    retentionEstimate: row.retentionEstimate,
  }));
}

async function loadHeatmap(userId: string) {
  const rows = await db.execute<{ date: string; count: number }>(sql`
    SELECT study_date::text AS date, cards_reviewed::int AS count
    FROM study_daily_logs
    WHERE user_id = ${userId}
    ORDER BY study_date DESC
    LIMIT 91
  `);

  return rows.reverse();
}

/**
 * Live reviews (migration backfill excluded) recorded in the trailing 7 days.
 * The window is closed at both ends: `reviewed_at` is client-supplied, so
 * without the upper bound a clock-skewed or future-dated event would inflate
 * "this week" — and the count would no longer be reproducible for a pinned
 * `asOf`.
 */
export function reviewedThisWeekSql(userId: string, asOf: Date): SQL {
  return sql`
    SELECT COUNT(*)::int AS "reviewedThisWeek"
    FROM fsrs_review_events e
    WHERE e.user_id = ${userId}::uuid
      AND e.origin = 'live'
      AND e.reviewed_at >= ${fsrsAsOf(asOf)} - interval '7 days'
      AND e.reviewed_at <= ${fsrsAsOf(asOf)}`;
}

async function loadTrends(userId: string, asOf = new Date()) {
  const [row] = await db.execute<{ reviewedThisWeek: number }>(
    reviewedThisWeekSql(userId, asOf),
  );

  return {
    reviewedThisWeek: row?.reviewedThisWeek ?? 0,
    retentionDelta: null,
  };
}
