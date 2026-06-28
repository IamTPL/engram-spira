import { sql } from 'drizzle-orm';
import { db } from '../../db';
import * as forecastService from '../study/forecast.service';
import * as recommendationsService from '../study/recommendations.service';
import { aggregateResponse, resolveSection } from './aggregate.helpers';
import type {
  AggregateResponse,
  CommandCenterResponse,
  InsightsOverviewResponse,
  InsightsOverviewSections,
} from './experience.types';

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

async function loadAtRiskCards(userId: string) {
  const rows = await db.execute<{
    id: string;
    deckId: string;
    title: string | null;
    retentionEstimate: number | null;
  }>(sql`
    SELECT
      c.id,
      c.deck_id AS "deckId",
      MIN(CASE WHEN tf.side = 'front' THEN cfv.value #>> '{}' END) AS title,
      GREATEST(
        0,
        LEAST(
          1,
          1 - (
            EXTRACT(EPOCH FROM (NOW() - sp.last_reviewed_at)) / 86400
          ) / GREATEST(COALESCE(sp.stability, sp.interval_days::real, 1), 1) * 0.1
        )
      ) AS "retentionEstimate"
    FROM study_progress sp
    JOIN cards c ON c.id = sp.card_id
    JOIN decks d ON d.id = c.deck_id
    LEFT JOIN card_field_values cfv ON cfv.card_id = c.id
    LEFT JOIN template_fields tf ON tf.id = cfv.template_field_id
    WHERE sp.user_id = ${userId}
      AND d.user_id = ${userId}
      AND sp.next_review_at > NOW()
      AND sp.last_reviewed_at IS NOT NULL
    GROUP BY c.id, c.deck_id, sp.last_reviewed_at, sp.stability, sp.interval_days
    ORDER BY "retentionEstimate" ASC, c.id ASC
    LIMIT 20
  `);

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

async function loadTrends(userId: string) {
  const [row] = await db.execute<{ reviewedThisWeek: number }>(sql`
    SELECT COUNT(*)::int AS "reviewedThisWeek"
    FROM review_logs
    WHERE user_id = ${userId}
      AND reviewed_at >= NOW() - interval '7 days'
  `);

  return {
    reviewedThisWeek: row?.reviewedThisWeek ?? 0,
    retentionDelta: null,
  };
}
